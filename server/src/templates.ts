import { pool } from './db.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

export function render(body: string, values: Record<string, string>) {
  const missing = extractVariables(body).filter((v) => values[v] === undefined || values[v] === '');
  if (missing.length) return { error: `missing values for: ${missing.join(', ')}` } as const;
  return { text: body.replace(PLACEHOLDER, (_, v: string) => values[v]) } as const;
}

const COLUMNS = 'id, name, category, body, variables, status, reject_reason, created_at, updated_at';

export async function listTemplates() {
  return (await pool.query(`SELECT ${COLUMNS} FROM templates ORDER BY updated_at DESC`)).rows;
}

export async function getTemplate(id: string) {
  return (await pool.query(`SELECT ${COLUMNS} FROM templates WHERE id = $1`, [id])).rows[0] ?? null;
}

export async function createTemplate(t: { name: string; category: string; body: string }) {
  const { rows } = await pool.query(
    `INSERT INTO templates (name, category, body, variables) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [t.name, t.category, t.body, extractVariables(t.body)],
  );
  return rows[0];
}

// Any edit sends the template back to draft, since approval covers the exact content.
export async function updateTemplate(id: string, t: { name: string; category: string; body: string }) {
  const { rows } = await pool.query(
    `UPDATE templates SET name = $2, category = $3, body = $4, variables = $5,
       status = 'draft', reject_reason = NULL, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, t.name, t.category, t.body, extractVariables(t.body)],
  );
  return rows[0] ?? null;
}

export async function setTemplateStatus(id: string, status: string, rejectReason: string | null = null) {
  const { rows } = await pool.query(
    `UPDATE templates SET status = $2, reject_reason = $3, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status, rejectReason],
  );
  return rows[0] ?? null;
}

export async function deleteTemplate(id: string) {
  const used = await pool.query(`SELECT 1 FROM messages WHERE template_id = $1 LIMIT 1`, [id]);
  if (used.rowCount) return 'in_use' as const;
  const res = await pool.query(`DELETE FROM templates WHERE id = $1`, [id]);
  return res.rowCount ? ('deleted' as const) : ('not_found' as const);
}
