import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { pool } from './db.js';

// The audience file needs one of these columns (any case, spaces or underscores) for the Truecaller number.
export const PHONE_HEADERS = ['phone', 'mobile', 'msisdn', 'number', 'phone_number', 'mobile_number', 'truecaller', 'truecaller_number'];
const headerKey = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

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

export interface CheckResult {
  rows: number;
  valid: number;
  duplicates_in_file: number;
  invalid: number;
  invalid_samples: { row: number; value: string }[];
  phone_column: string;
  attribute_columns: string[];
  preview: { phone: string; attributes: Record<string, string> }[];
}

export interface UploadResult extends Omit<CheckResult, 'valid' | 'preview'> {
  added: number;
  updated: number;
}

// Reads header + rows into contacts. Every column other than the phone column becomes an
// attribute that templates use as {{column}} (lower case, spaces turned into underscores).
export function checkRecords(records: string[][]): { result: CheckResult; contacts: Map<string, Record<string, string>> } | { error: string } {
  if (records.length < 2) return { error: 'The file needs a header row and at least one contact.' };
  const header = records[0].map((h) => h.trim());
  const phoneIdx = header.findIndex((h) => PHONE_HEADERS.includes(headerKey(h)));
  if (phoneIdx === -1) {
    return { error: `No phone column found. Name the column with the Truecaller numbers "phone" (also accepted: ${PHONE_HEADERS.slice(1).join(', ')}).` };
  }
  const attrCols = header.map((h, i) => ({ key: headerKey(h), i })).filter((c) => c.i !== phoneIdx && c.key);

  const contacts = new Map<string, Record<string, string>>();
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
    if (contacts.has(phone)) dupes++;
    contacts.set(phone, Object.fromEntries(attrCols.map((c) => [c.key, r[c.i] ?? ''])));
  });

  return {
    contacts,
    result: {
      rows: records.length - 1,
      valid: contacts.size,
      duplicates_in_file: dupes,
      invalid: invalidCount,
      invalid_samples: invalid,
      phone_column: header[phoneIdx],
      attribute_columns: attrCols.map((c) => c.key),
      preview: [...contacts].slice(0, 5).map(([phone, attributes]) => ({ phone, attributes })),
    },
  };
}

// Upserts contacts into a list. Re-uploading a number updates its attributes.
export async function importRecords(listId: string, records: string[][]): Promise<UploadResult | { error: string }> {
  const checked = checkRecords(records);
  if ('error' in checked) return checked;
  const { contacts, result } = checked;

  const phones = [...contacts.keys()];
  const attrs = phones.map((p) => JSON.stringify(contacts.get(p)));
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
      [listId, result.attribute_columns],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { valid: _v, preview: _p, ...rest } = result;
  return { ...rest, added, updated: phones.length - added };
}
