import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiKey } from '../auth.js';
import { createList, deleteList, getList, importCsv, listContacts, listLists } from '../lists.js';

const Id = z.object({ id: z.string().uuid() });
const Page = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0) });

export async function listRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireApiKey);
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/v1/lists', async () => ({ data: await listLists() }));

  app.post('/v1/lists', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    try {
      return reply.code(201).send(await createList(parsed.data.name));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'a list with this name exists' });
      throw err;
    }
  });

  app.get('/v1/lists/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const l = p.success ? await getList(p.data.id) : null;
    return l ?? reply.code(404).send({ error: 'not found' });
  });

  app.delete('/v1/lists/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const res = await deleteList(p.data.id);
    if (res === 'not_found') return reply.code(404).send({ error: 'not found' });
    if (res === 'in_use') return reply.code(409).send({ error: 'list is used by a campaign and cannot be deleted' });
    return reply.code(204).send();
  });

  app.get('/v1/lists/:id/contacts', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const q = Page.safeParse(req.query);
    if (!p.success || !(await getList(p.data.id))) return reply.code(404).send({ error: 'not found' });
    if (!q.success) return reply.code(400).send({ error: 'invalid paging', details: q.error.issues });
    return { data: await listContacts(p.data.id, q.data.limit, q.data.offset) };
  });

  // Body is the raw CSV (content-type text/csv). Needs a phone column; other columns become variables.
  app.post('/v1/lists/:id/import', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success || !(await getList(p.data.id))) return reply.code(404).send({ error: 'not found' });
    if (typeof req.body !== 'string') return reply.code(415).send({ error: 'send the CSV with content-type text/csv' });
    const res = await importCsv(p.data.id, req.body);
    return 'error' in res ? reply.code(400).send(res) : res;
  });
}
