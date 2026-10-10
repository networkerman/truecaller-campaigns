import { parse } from 'csv-parse/sync';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { pool } from './db.js';

const PHONE_HEADERS = ['phone', 'mobile', 'number', 'msisdn', 'phone_number', 'mobile_number', 'to'];
const MAX_ROWS = 100_000;

// "First Name" -> "first_name", so columns line up with {{variables}}.
const normalise = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const COLUMNS = `l.id, l.name, l.columns, l.created_at, l.updated_at,
  (SELECT count(*)::int FROM contacts c WHERE c.list_id = l.id) AS contact_count`;

export async function listLists() {
  return (await pool.query(`SELECT ${COLUMNS} FROM contact_lists l ORDER BY l.updated_at DESC`)).rows;
}

export async function getList(id: string) {
  return (await pool.query(`SELECT ${COLUMNS} FROM contact_lists l WHERE l.id = $1`, [id])).rows[0] ?? null;
}

export async function createList(name: string) {
  const { rows } = await pool.query(`INSERT INTO contact_lists (name) VALUES ($1) RETURNING id`, [name]);
  return getList(rows[0].id);
}

export async function deleteList(id: string) {
  const used = await pool.query(`SELECT 1 FROM campaigns WHERE list_id = $1 LIMIT 1`, [id]);
  if (used.rowCount) return 'in_use' as const;
  const res = await pool.query(`DELETE FROM contact_lists WHERE id = $1`, [id]);
  return res.rowCount ? ('deleted' as const) : ('not_found' as const);
}

export async function listContacts(listId: string, limit: number, offset: number) {
  const { rows } = await pool.query(
    `SELECT id, phone, attrs, created_at FROM contacts WHERE list_id = $1 ORDER BY created_at, id LIMIT $2 OFFSET $3`,
    [listId, limit, offset],
  );
  return rows;
}

export interface ImportResult {
  rows: number;
  added: number;
  updated: number;
  duplicates: number;
  invalid: { row: number; value: string; reason: string }[];
  invalid_count: number;
  columns: string[];
}

// Imports a CSV into a list. Existing numbers get their attributes replaced, so a re-upload refreshes data.
export async function importCsv(listId: string, csv: string): Promise<ImportResult | { error: string }> {
  let records: string[][];
  try {
    records = parse(csv, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (err) {
    return { error: `could not read CSV: ${(err as Error).message}` };
  }
  if (records.length < 2) return { error: 'CSV needs a header row and at least one contact' };
  if (records.length - 1 > MAX_ROWS) return { error: `CSV has more than ${MAX_ROWS.toLocaleString()} rows` };

  const headers = records[0].map(normalise);
  const phoneIdx = headers.findIndex((h) => PHONE_HEADERS.includes(h));
  if (phoneIdx === -1) return { error: `no phone column found. Name one of the columns: ${PHONE_HEADERS.slice(0, 4).join(', ')}` };
  const attrCols = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => i !== phoneIdx && h);

  const byPhone = new Map<string, Record<string, string>>();
  const invalid: ImportResult['invalid'] = [];
  let invalidCount = 0;
  let duplicates = 0;
  records.slice(1).forEach((r, n) => {
    const raw = r[phoneIdx] ?? '';
    // Bare 10-digit numbers are treated as Indian, the first market.
    const phone = parsePhoneNumberFromString(raw, 'IN');
    if (!phone?.isValid()) {
      invalidCount++;
      if (invalid.length < 50) invalid.push({ row: n + 2, value: raw, reason: raw ? 'not a valid phone number' : 'empty phone' });
      return;
    }
    if (byPhone.has(phone.number)) duplicates++;
    byPhone.set(phone.number, Object.fromEntries(attrCols.map(({ h, i }) => [h, r[i] ?? ''])));
  });

  const client = await pool.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    const entries = [...byPhone];
    for (let i = 0; i < entries.length; i += 1000) {
      const chunk = entries.slice(i, i + 1000);
      const res = await client.query(
        `INSERT INTO contacts (list_id, phone, attrs)
         SELECT $1, p, a::jsonb FROM unnest($2::text[], $3::text[]) AS t(p, a)
         ON CONFLICT (list_id, phone) DO UPDATE SET attrs = EXCLUDED.attrs
         RETURNING (xmax = 0) AS inserted`,
        [listId, chunk.map(([p]) => p), chunk.map(([, a]) => JSON.stringify(a))],
      );
      added += res.rows.filter((x) => x.inserted).length;
    }
    await client.query(
      `UPDATE contact_lists SET columns = ARRAY(SELECT DISTINCT unnest(columns || $2::text[]) ORDER BY 1), updated_at = now()
       WHERE id = $1`,
      [listId, attrCols.map((c) => c.h)],
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
    updated: byPhone.size - added,
    duplicates,
    invalid,
    invalid_count: invalidCount,
    columns: attrCols.map((c) => c.h),
  };
}
