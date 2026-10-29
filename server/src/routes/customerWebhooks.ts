import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAuth, requirePermission } from '../auth.js';
import { config } from '../config.js';
import { EVENTS, MAX_ATTEMPTS, MAX_ENDPOINTS, attempt, newSecret } from '../customerWebhooks.js';
import { pool } from '../db.js';

const Id = z.object({ id: z.string().uuid() });
const url = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => u.startsWith('https://') || (config.webhookAllowPrivate && u.startsWith('http://')), 'The URL must start with https://');
const Body = z.object({
  url,
  description: z.string().trim().max(200).default(''),
  events: z.array(z.enum(EVENTS)).min(1, 'Pick at least one event'),
  enabled: z.boolean().default(true),
});

const COLS = `id, url, description, events, enabled, created_at, updated_at, secret,
  (SELECT count(*)::int FROM webhook_deliveries d WHERE d.endpoint_id = e.id AND d.status = 'failed' AND d.created_at > now() - interval '24 hours') AS failed_24h,
  (SELECT max(d.delivered_at) FROM webhook_deliveries d WHERE d.endpoint_id = e.id) AS last_delivered_at`;

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? 'invalid input';

// Customer webhooks: where we POST message and campaign events. Managed by the same roles as API keys.
export async function customerWebhookRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  app.addHook('preHandler', requirePermission('keys:manage'));

  app.get('/v1/webhooks', async (req) => {
    const { rows } = await pool.query(`SELECT ${COLS} FROM webhook_endpoints e WHERE workspace_id = $1 ORDER BY created_at`, [req.ctx.workspaceId]);
    return { data: rows, events: EVENTS, max_attempts: MAX_ATTEMPTS };
  });

  app.post('/v1/webhooks', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const { rows: n } = await pool.query(`SELECT count(*)::int AS n FROM webhook_endpoints WHERE workspace_id = $1`, [req.ctx.workspaceId]);
    if (n[0].n >= MAX_ENDPOINTS) return reply.code(409).send({ error: `A workspace can have up to ${MAX_ENDPOINTS} webhooks.` });
    const { url, description, events, enabled } = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO webhook_endpoints (workspace_id, url, description, events, enabled, secret) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.ctx.workspaceId, url, description, events, enabled, newSecret()],
    );
    await audit(req.ctx, 'webhook.created', { id: rows[0].id, url });
    const { rows: out } = await pool.query(`SELECT ${COLS} FROM webhook_endpoints e WHERE id = $1`, [rows[0].id]);
    return reply.code(201).send(out[0]);
  });

  app.put('/v1/webhooks/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const parsed = Body.safeParse(req.body);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const { url, description, events, enabled } = parsed.data;
    const { rowCount } = await pool.query(
      `UPDATE webhook_endpoints SET url = $3, description = $4, events = $5, enabled = $6, updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [p.data.id, req.ctx.workspaceId, url, description, events, enabled],
    );
    if (!rowCount) return reply.code(404).send({ error: 'not found' });
    await audit(req.ctx, 'webhook.updated', { id: p.data.id, url, enabled });
    const { rows } = await pool.query(`SELECT ${COLS} FROM webhook_endpoints e WHERE id = $1`, [p.data.id]);
    return rows[0];
  });

  app.delete('/v1/webhooks/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const { rowCount } = await pool.query(`DELETE FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`, [p.data.id, req.ctx.workspaceId]);
    if (!rowCount) return reply.code(404).send({ error: 'not found' });
    await audit(req.ctx, 'webhook.deleted', { id: p.data.id });
    return reply.code(204).send();
  });

  // The old secret stops working at once, so update the receiving side straight after.
  app.post('/v1/webhooks/:id/rotate-secret', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const { rows } = await pool.query(
      `UPDATE webhook_endpoints SET secret = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING id`,
      [p.data.id, req.ctx.workspaceId, newSecret()],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit(req.ctx, 'webhook.secret_rotated', { id: p.data.id });
    const { rows: out } = await pool.query(`SELECT ${COLS} FROM webhook_endpoints e WHERE id = $1`, [p.data.id]);
    return out[0];
  });

  // Sends a sample event right away (whatever the event subscription) and returns the result.
  app.post('/v1/webhooks/:id/test', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const payload = {
      id: `evt_test_${Date.now()}`,
      type: 'webhook.test',
      created_at: new Date().toISOString(),
      data: { message: 'Test event from OneXtel Truecaller campaigns. No action needed.' },
    };
    const { rows } = await pool.query(
      `INSERT INTO webhook_deliveries (endpoint_id, event, payload)
       SELECT id, 'webhook.test', $3 FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2
       RETURNING id`,
      [p.data.id, req.ctx.workspaceId, JSON.stringify(payload)],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    // A test is a one-off: it is never retried.
    const res = await attempt(rows[0].id);
    if (res?.status === 'pending') await pool.query(`UPDATE webhook_deliveries SET status = 'failed' WHERE id = $1`, [rows[0].id]);
    return { ...res, status: res?.status === 'pending' ? 'failed' : res?.status };
  });

  app.get('/v1/webhooks/:id/deliveries', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const status = (req.query as { status?: string }).status;
    const { rows } = await pool.query(
      `SELECT d.id, d.event, d.status, d.attempts, d.response_code, d.last_error, d.created_at, d.delivered_at,
         CASE WHEN d.status = 'pending' THEN d.next_attempt_at END AS next_attempt_at, d.payload
       FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
       WHERE e.id = $1 AND e.workspace_id = $2 AND ($3::text IS NULL OR d.status = $3)
       ORDER BY d.created_at DESC LIMIT 100`,
      [p.data.id, req.ctx.workspaceId, status && ['pending', 'delivered', 'failed'].includes(status) ? status : null],
    );
    return { data: rows };
  });

  // Sends a delivery again now. A failed one gets a fresh set of retries.
  app.post('/v1/webhooks/deliveries/:id/retry', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const { rows } = await pool.query(
      `UPDATE webhook_deliveries d SET status = 'pending', attempts = 0, next_attempt_at = now()
       FROM webhook_endpoints e WHERE d.id = $1 AND e.id = d.endpoint_id AND e.workspace_id = $2 AND d.status <> 'delivered'
       RETURNING d.id`,
      [p.data.id, req.ctx.workspaceId],
    );
    if (!rows[0]) return reply.code(409).send({ error: 'Only pending or failed deliveries can be retried.' });
    return attempt(rows[0].id);
  });
}
