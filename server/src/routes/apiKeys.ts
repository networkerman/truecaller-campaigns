import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateKey, requireApiKey } from '../auth.js';
import { pool } from '../db.js';

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireApiKey);

  app.get('/v1/api-keys', async () => {
    const { rows } = await pool.query(
      `SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC`,
    );
    return { data: rows };
  });

  // The full key is returned only here, once.
  app.post('/v1/api-keys', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'name is required' });
    const k = generateKey();
    const { rows } = await pool.query(
      `INSERT INTO api_keys (name, prefix, key_hash) VALUES ($1, $2, $3)
       RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
      [parsed.data.name, k.prefix, k.hash],
    );
    return reply.code(201).send({ ...rows[0], key: k.key });
  });

  app.post('/v1/api-keys/:id/revoke', async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const { rows } = await pool.query(
      `UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1
       RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
      [p.data.id],
    );
    return rows[0] ?? reply.code(404).send({ error: 'not found' });
  });
}
