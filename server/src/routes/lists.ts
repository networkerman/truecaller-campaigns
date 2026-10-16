import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth.js';
import { pool } from '../db.js';
import { checkRecords, createList, deleteList, getList, importRecords, listLists, normalizePhone, sampleContacts } from '../lists.js';
import { MAX_AUDIENCE_BYTES, SourceError, XLSX_TYPE, readFile, rowsFromLink } from '../sources.js';

const Id = z.object({ id: z.string().uuid() });
const LinkBody = z.object({ source: z.enum(['sheet', 'url']), url: z.string().trim().min(1).max(2000) });

// An audience arrives as a raw CSV body (text/csv), a raw .xlsx body, or JSON
// { "source": "sheet" | "url", "url": "..." } for a public Google Sheet or CSV link.
async function rowsFromRequest(body: unknown): Promise<string[][] | { error: string; status: number }> {
  try {
    if (typeof body === 'string' || Buffer.isBuffer(body)) return await readFile(body);
    const link = LinkBody.safeParse(body);
    if (link.success) return await rowsFromLink(link.data.source, link.data.url);
    return { status: 415, error: 'Send a CSV (text/csv) or .xlsx file, or JSON with source and url.' };
  } catch (err) {
    if (err instanceof SourceError) return { status: 400, error: err.message };
    throw err;
  }
}

export async function listRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: MAX_AUDIENCE_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.addContentTypeParser([XLSX_TYPE, 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_AUDIENCE_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  const manage = { preHandler: requirePermission('campaigns:manage') };
  const view = { preHandler: requirePermission('reports:view') };

  app.get('/v1/lists', view, async (req) => ({ data: await listLists(req.ctx.workspaceId) }));

  app.post('/v1/lists', manage, async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'name is required' });
    try {
      return reply.code(201).send(await createList(req.ctx.workspaceId, parsed.data.name));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'a list with this name exists' });
      throw err;
    }
  });

  app.get('/v1/lists/:id', view, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const list = p.success ? await getList(req.ctx.workspaceId, p.data.id) : null;
    if (!list) return reply.code(404).send({ error: 'not found' });
    return { ...list, sample: await sampleContacts(req.ctx.workspaceId, list.id) };
  });

  app.delete('/v1/lists/:id', manage, async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const res = await deleteList(req.ctx.workspaceId, p.data.id);
    if (res === 'not_found') return reply.code(404).send({ error: 'not found' });
    if (res === 'in_use') return reply.code(409).send({ error: 'list is used by a campaign and cannot be deleted' });
    return reply.code(204).send();
  });

  // Checks an audience without saving it: counts, invalid numbers, columns and a short preview.
  app.post('/v1/lists/validate', manage, async (req, reply) => {
    const rows = await rowsFromRequest(req.body);
    if (!Array.isArray(rows)) return reply.code(rows.status).send({ error: rows.error });
    const checked = checkRecords(rows);
    return 'error' in checked ? reply.code(400).send(checked) : checked.result;
  });

  app.post('/v1/lists/:id/contacts', manage, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const list = p.success ? await getList(req.ctx.workspaceId, p.data.id) : null;
    if (!list) return reply.code(404).send({ error: 'not found' });
    const rows = await rowsFromRequest(req.body);
    if (!Array.isArray(rows)) return reply.code(rows.status).send({ error: rows.error });
    const res = await importRecords(list.id, rows);
    return 'error' in res ? reply.code(400).send(res) : res;
  });

  app.post('/v1/opt-outs', manage, async (req, reply) => {
    const parsed = z.object({ phone: z.string() }).safeParse(req.body);
    const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
    if (!phone) return reply.code(400).send({ error: 'invalid phone number' });
    await pool.query(`INSERT INTO opt_outs (workspace_id, phone) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.ctx.workspaceId, phone]);
    return reply.code(201).send({ phone, opted_out: true });
  });

  app.delete('/v1/opt-outs/:phone', manage, async (req, reply) => {
    const phone = normalizePhone((req.params as { phone: string }).phone);
    if (!phone) return reply.code(400).send({ error: 'invalid phone number' });
    await pool.query(`DELETE FROM opt_outs WHERE workspace_id = $1 AND phone = $2`, [req.ctx.workspaceId, phone]);
    return reply.code(204).send();
  });
}
