import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createKey, listKeys, revokeKey } from '../apiKeys.js';
import { requireApiKey } from '../auth.js';

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireApiKey);

  app.get('/v1/api-keys', async () => ({ data: await listKeys() }));

  app.post('/v1/api-keys', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    return reply.code(201).send(await createKey(parsed.data.name));
  });

  app.delete('/v1/api-keys/:id', async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!p.success || !(await revokeKey(p.data.id))) return reply.code(404).send({ error: 'not found or already revoked' });
    return reply.code(204).send();
  });
}
