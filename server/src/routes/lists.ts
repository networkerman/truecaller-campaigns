import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db.js';
import { createList, deleteList, getList, importCsv, listLists, normalizePhone, sampleContacts } from '../lists.js';

const Id = z.object({ id: z.string().uuid() });

export async function listRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/v1/lists', async () => ({ data: await listLists() }));

  app.post('/v1/lists', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'name is required' });
    try {
      return reply.code(201).send(await createList(parsed.data.name));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'a list with this name exists' });
      throw err;
    }
  });

  app.get('/v1/lists/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const list = p.success ? await getList(p.data.id) : null;
    if (!list) return reply.code(404).send({ error: 'not found' });
    return { ...list, sample: await sampleContacts(list.id) };
  });

  app.delete('/v1/lists/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const res = await deleteList(p.data.id);
    if (res === 'not_found') return reply.code(404).send({ error: 'not found' });
    if (res === 'in_use') return reply.code(409).send({ error: 'list is used by a campaign and cannot be deleted' });
    return reply.code(204).send();
  });

  // Body is the raw CSV file, sent with Content-Type: text/csv.
  app.post('/v1/lists/:id/contacts', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const list = p.success ? await getList(p.data.id) : null;
    if (!list) return reply.code(404).send({ error: 'not found' });
    if (typeof req.body !== 'string') return reply.code(415).send({ error: 'send the CSV file with Content-Type: text/csv' });
    const res = await importCsv(list.id, req.body);
    return 'error' in res ? reply.code(400).send(res) : res;
  });

  app.post('/v1/opt-outs', async (req, reply) => {
    const parsed = z.object({ phone: z.string() }).safeParse(req.body);
    const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
    if (!phone) return reply.code(400).send({ error: 'invalid phone number' });
    await pool.query(`INSERT INTO opt_outs (phone) VALUES ($1) ON CONFLICT DO NOTHING`, [phone]);
    return reply.code(201).send({ phone, opted_out: true });
  });

  app.delete('/v1/opt-outs/:phone', async (req, reply) => {
    const phone = normalizePhone((req.params as { phone: string }).phone);
    if (!phone) return reply.code(400).send({ error: 'invalid phone number' });
    await pool.query(`DELETE FROM opt_outs WHERE phone = $1`, [phone]);
    return reply.code(204).send();
  });
}
