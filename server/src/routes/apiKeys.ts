import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, generateKey, requireAuth, requirePermission } from '../auth.js';
import { pool } from '../db.js';

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  app.addHook('preHandler', requirePermission('keys:manage'));

  app.get('/v1/api-keys', async (req) => {
    const { rows } = await pool.query(
      `SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [req.ctx.workspaceId],
    );
    return { data: rows };
  });

  // The full key is returned only here, once.
  app.post('/v1/api-keys', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'name is required' });
    const k = generateKey();
    const { rows } = await pool.query(
      `INSERT INTO api_keys (workspace_id, name, prefix, key_hash) VALUES ($4, $1, $2, $3)
       RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
      [parsed.data.name, k.prefix, k.hash, req.ctx.workspaceId],
    );
    await audit(req.ctx, 'api_key.created', { id: rows[0].id, name: parsed.data.name, prefix: k.prefix });
    return reply.code(201).send({ ...rows[0], key: k.key });
  });

  app.post('/v1/api-keys/:id/revoke', async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const { rows } = await pool.query(
      `UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND workspace_id = $2
       RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
      [p.data.id, req.ctx.workspaceId],
    );
    if (rows[0]) await audit(req.ctx, 'api_key.revoked', { id: rows[0].id, name: rows[0].name });
    return rows[0] ?? reply.code(404).send({ error: 'not found' });
  });
}
