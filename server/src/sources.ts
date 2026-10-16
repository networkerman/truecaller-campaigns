import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

// Audience files can come from an upload, a public Google Sheet, or a public CSV link.
// Everything ends up as rows of strings, header first.

export const MAX_AUDIENCE_BYTES = 50 * 1024 * 1024;
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class SourceError extends Error {}

export function readCsv(text: string): string[][] {
  try {
    return parse(text, { skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (err) {
    throw new SourceError(`Could not read the CSV: ${(err as Error).message}`);
  }
}

export async function readXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new SourceError('Could not read the .xlsx file. Save it again from Excel or Google Sheets and retry.');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new SourceError('The .xlsx file has no sheets.');
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= row.cellCount; i++) cells.push(row.getCell(i).text.trim());
    if (cells.some(Boolean)) rows.push(cells);
  });
  return rows;
}

// .xlsx files are zip archives, so they start with "PK".
export const looksLikeXlsx = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;

export function readFile(body: Buffer | string): Promise<string[][]> | string[][] {
  if (typeof body === 'string') return readCsv(body);
  return looksLikeXlsx(body) ? readXlsx(body) : readCsv(body.toString('utf8'));
}

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'rb.gy', 'cutt.ly', 'is.gd', 'ow.ly', 'shorturl.at', 'tiny.cc', 'buff.ly', 'rebrand.ly'];

// Turns a normal Google Sheets link into its CSV export link, keeping the tab (gid) if there is one.
export function sheetExportUrl(link: string) {
  const m = link.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

export async function rowsFromLink(kind: 'sheet' | 'url', link: string): Promise<string[][]> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new SourceError('That is not a valid link.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new SourceError('The link must start with https://');
  if (SHORTENERS.includes(url.hostname.replace(/^www\./, ''))) throw new SourceError('Shortened links are not accepted. Paste the full link.');

  if (kind === 'sheet') {
    const exportUrl = sheetExportUrl(url.href);
    if (!exportUrl) throw new SourceError('That is not a Google Sheets link. It should look like https://docs.google.com/spreadsheets/d/…');
    const res = await download(exportUrl);
    if (res.type.includes('html')) {
      throw new SourceError('Could not open the sheet. Set General access to "Anyone with the link" and try again.');
    }
    return readCsv(res.body.toString('utf8'));
  }

  const res = await download(url.href);
  if (res.type.includes('html')) throw new SourceError('The link opened a web page, not a CSV file. Use a direct link to the file.');
  if (looksLikeXlsx(res.body)) throw new SourceError('The link points to an .xlsx file. Public links need to be CSV.');
  return readCsv(res.body.toString('utf8'));
}

// Links are fetched from our server, so never let one reach the box itself, the private network,
// or the EC2 metadata service. The check runs on the resolved address, at connect time.
const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['::ffff:0:0', 96]] as const) blocked.addSubnet(net, bits, 'ipv6');

const safeLookup: LookupFunction = (host, opts, cb) => {
  dnsLookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, '', 4);
    const list = addrs as LookupAddress[];
    const bad = list.find((a) => blocked.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
    if (bad || !list.length) return cb(new SourceError('That link points to a private address.'), '', 4);
    if ((opts as { all?: boolean }).all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

function download(href: string, redirects = 5): Promise<{ body: Buffer; type: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(href);
    if (isIP(url.hostname) && blocked.check(url.hostname, isIP(url.hostname) === 6 ? 'ipv6' : 'ipv4')) {
      return reject(new SourceError('That link points to a private address.'));
    }
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { lookup: safeLookup, timeout: 20_000, headers: { 'user-agent': 'truecaller-campaigns' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new SourceError('The link redirects too many times.'));
        return resolve(download(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (status !== 200) {
        res.resume();
        return reject(new SourceError(`The link returned an error (HTTP ${status}). Check it opens without signing in.`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_AUDIENCE_BYTES) {
          req.destroy(new SourceError('The file is larger than 50 MB.'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] ?? '') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new SourceError('The link took too long to respond.')));
    req.on('error', (err) => reject(err instanceof SourceError ? err : new SourceError(`Could not open the link: ${err.message}`)));
  });
}
