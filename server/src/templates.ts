import { pool } from './db.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

// A contact's own value wins; an empty or missing one falls back to the default, if there is one.
export function render(body: string, values: Record<string, string>, defaults: Record<string, string> = {}) {
  // List columns are stored lower case, so {{Name}} still finds the name column.
  const pick = (v: string) => {
    const own = values[v] ?? values[v.toLowerCase()];
    return own !== undefined && String(own).trim() !== '' ? String(own) : defaults[v] ?? '';
  };
  const missing = extractVariables(body).filter((v) => pick(v) === '');
  if (missing.length) return { error: `missing values for: ${missing.join(', ')}` } as const;
  return { text: body.replace(PLACEHOLDER, (_, v: string) => pick(v)) } as const;
}

// Keeps only defaults for variables the body uses, trimmed, dropping empty ones.
export function cleanDefaults(body: string, defaults: Record<string, string> | undefined) {
  const vars = new Set(extractVariables(body));
  return Object.fromEntries(
    Object.entries(defaults ?? {}).map(([k, v]) => [k, String(v).trim()]).filter(([k, v]) => vars.has(k) && v !== ''),
  );
}

const COLUMNS = 'id, name, category, body, variables, variable_defaults, media, buttons, status, reject_reason, created_at, updated_at';

export async function listTemplates(ws: string) {
  return (await pool.query(`SELECT ${COLUMNS} FROM templates WHERE workspace_id = $1 ORDER BY updated_at DESC`, [ws])).rows;
}

export async function getTemplate(ws: string, id: string) {
  return (await pool.query(`SELECT ${COLUMNS} FROM templates WHERE id = $1 AND workspace_id = $2`, [id, ws])).rows[0] ?? null;
}

type TemplateFields = {
  name: string;
  category: string;
  body: string;
  variable_defaults?: Record<string, string>;
  media?: { url: string; mime_type: string; file_name?: string } | null;
  buttons?: ({ type: 'link'; text: string; url: string } | { type: 'reply'; text: string })[];
};

// Variables used anywhere in the message: body, button labels and button URLs.
const allText = (t: TemplateFields) => [t.body, ...(t.buttons ?? []).flatMap((b) => [b.text, 'url' in b ? b.url : ''])].join('\n');

export async function createTemplate(ws: string, t: TemplateFields) {
  const { rows } = await pool.query(
    `INSERT INTO templates (workspace_id, name, category, body, variables, variable_defaults, media, buttons)
     VALUES ($5, $1, $2, $3, $4, $6, $7, $8) RETURNING ${COLUMNS}`,
    [t.name, t.category, t.body, extractVariables(allText(t)), ws, cleanDefaults(allText(t), t.variable_defaults), t.media ?? null, JSON.stringify(t.buttons ?? [])],
  );
  return rows[0];
}

// Any edit sends the template back to draft, since approval covers the exact content.
export async function updateTemplate(ws: string, id: string, t: TemplateFields) {
  const { rows } = await pool.query(
    `UPDATE templates SET name = $2, category = $3, body = $4, variables = $5, variable_defaults = $7,
       media = $8, buttons = $9, status = 'draft', reject_reason = NULL, updated_at = now()
     WHERE id = $1 AND workspace_id = $6 RETURNING ${COLUMNS}`,
    [id, t.name, t.category, t.body, extractVariables(allText(t)), ws, cleanDefaults(allText(t), t.variable_defaults), t.media ?? null, JSON.stringify(t.buttons ?? [])],
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

export async function deleteTemplate(ws: string, id: string) {
  const used = await pool.query(`SELECT 1 FROM messages WHERE template_id = $1 LIMIT 1`, [id]);
  if (used.rowCount) return 'in_use' as const;
  const res = await pool.query(`DELETE FROM templates WHERE id = $1 AND workspace_id = $2`, [id, ws]);
  return res.rowCount ? ('deleted' as const) : ('not_found' as const);
}
