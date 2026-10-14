import { parse } from 'csv-parse/sync';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { pool } from './db.js';

const PHONE_HEADERS = ['phone', 'mobile', 'msisdn', 'number', 'phone_number', 'mobile_number', 'phone number', 'mobile number'];

export function normalizePhone(raw: string) {
  // Bare 10-digit numbers are treated as Indian, the first market.
  const p = parsePhoneNumberFromString(String(raw).trim(), 'IN');
  return p?.isValid() ? p.number : null;
}

export async function listLists(ws: string) {
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.columns, l.created_at, count(c.id)::int AS contact_count
     FROM contact_lists l LEFT JOIN contacts c ON c.list_id = l.id
     WHERE l.workspace_id = $1 GROUP BY l.id ORDER BY l.created_at DESC`,
    [ws],
  );
  return rows;
}

export async function getList(ws: string, id: string) {
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.columns, l.created_at,
       (SELECT count(*)::int FROM contacts WHERE list_id = l.id) AS contact_count
     FROM contact_lists l WHERE l.id = $1 AND l.workspace_id = $2`,
    [id, ws],
  );
  return rows[0] ?? null;
}

export async function createList(ws: string, name: string) {
  const { rows } = await pool.query(
    `INSERT INTO contact_lists (workspace_id, name) VALUES ($1, $2) RETURNING id, name, columns, created_at`,
    [ws, name],
  );
  return { ...rows[0], contact_count: 0 };
}

export async function deleteList(ws: string, id: string) {
  const used = await pool.query(`SELECT 1 FROM campaigns WHERE list_id = $1 LIMIT 1`, [id]);
  if (used.rowCount) return 'in_use' as const;
  const res = await pool.query(`DELETE FROM contact_lists WHERE id = $1 AND workspace_id = $2`, [id, ws]);
  return res.rowCount ? ('deleted' as const) : ('not_found' as const);
}

export async function sampleContacts(ws: string, listId: string, limit = 50) {
  const { rows } = await pool.query(
    `SELECT c.phone, c.attributes, (o.phone IS NOT NULL) AS opted_out
     FROM contacts c LEFT JOIN opt_outs o ON o.phone = c.phone AND o.workspace_id = $3
     WHERE c.list_id = $1 ORDER BY c.created_at LIMIT $2`,
    [listId, limit, ws],
  );
  return rows;
}

export interface UploadResult {
  rows: number;
  added: number;
  updated: number;
  duplicates_in_file: number;
  invalid: number;
  invalid_samples: { row: number; value: string }[];
  phone_column: string;
  attribute_columns: string[];
}

// Upserts contacts from CSV. The phone column is found by header name, else the first column is used.
// Every other column becomes a contact attribute that templates can use as {{column}}.
export async function importCsv(listId: string, csv: string): Promise<UploadResult | { error: string }> {
  let records: string[][];
  try {
    records = parse(csv, { skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (err) {
    return { error: `could not read CSV: ${(err as Error).message}` };
  }
  if (records.length < 2) return { error: 'CSV needs a header row and at least one contact' };

  const header = records[0].map((h) => h.trim());
  let phoneIdx = header.findIndex((h) => PHONE_HEADERS.includes(h.toLowerCase()));
  if (phoneIdx === -1) phoneIdx = 0;
  const attrCols = header
    .map((h, i) => ({ key: h.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''), i }))
    .filter((c) => c.i !== phoneIdx && c.key);

  const seen = new Map<string, Record<string, string>>();
  const invalid: { row: number; value: string }[] = [];
  let invalidCount = 0;
  let dupes = 0;

  records.slice(1).forEach((r, n) => {
    const phone = normalizePhone(r[phoneIdx] ?? '');
    if (!phone) {
      invalidCount++;
      if (invalid.length < 20) invalid.push({ row: n + 2, value: r[phoneIdx] ?? '' });
      return;
    }
    if (seen.has(phone)) dupes++;
    seen.set(phone, Object.fromEntries(attrCols.map((c) => [c.key, r[c.i] ?? ''])));
  });

  const phones = [...seen.keys()];
  const attrs = phones.map((p) => JSON.stringify(seen.get(p)));
  let added = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < phones.length; i += 5000) {
      const { rows } = await client.query(
        `INSERT INTO contacts (list_id, phone, attributes)
         SELECT $1, p, a::jsonb FROM unnest($2::text[], $3::text[]) AS t(p, a)
         ON CONFLICT (list_id, phone) DO UPDATE SET attributes = contacts.attributes || EXCLUDED.attributes
         RETURNING (xmax = 0) AS inserted`,
        [listId, phones.slice(i, i + 5000), attrs.slice(i, i + 5000)],
      );
      added += rows.filter((r) => r.inserted).length;
    }
    await client.query(
      `UPDATE contact_lists SET columns = ARRAY(SELECT DISTINCT unnest(columns || $2::text[]) ORDER BY 1) WHERE id = $1`,
      [listId, attrCols.map((c) => c.key)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    rows: records.length - 1,
    added,
    updated: phones.length - added,
    duplicates_in_file: dupes,
    invalid: invalidCount,
    invalid_samples: invalid,
    phone_column: header[phoneIdx],
    attribute_columns: attrCols.map((c) => c.key),
  };
}
