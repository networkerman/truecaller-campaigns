import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, requireAuth, requirePermission } from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';

const Id = z.object({ id: z.string().uuid() });
const category = z.enum(['promotional', 'transactional', 'service']);
const RequestBody = z.object({
  display_name: z.string().trim().min(2, 'Enter the name people will see').max(60),
  legal_name: z.string().trim().min(2, 'Enter the registered business name').max(200),
  category,
  website: z.string().trim().max(300).default(''),
  use_case: z.string().trim().min(10, 'Describe what you will send, in a sentence or two').max(1000),
  monthly_volume: z.string().trim().max(50).default(''),
});
const SenderBody = z.object({
  sender_id: z.string().trim().min(2).max(64),
  display_name: z.string().trim().min(2).max(60),
  category,
});

const superAdminOnly = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.ctx.superAdmin) return reply.code(403).send({ error: 'Only OneXtel admins can add or change senders.' });
};
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? 'invalid input';

// Truecaller sender profiles. Registering a sender with Truecaller is done by OneXtel by hand, so
// customers file a request here and a OneXtel super admin adds the sender once it is live.
export async function senderRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/v1/senders', { preHandler: requirePermission('reports:view') }, async (req) => {
    const ws = req.ctx.workspaceId;
    const [senders, requests] = await Promise.all([
      pool.query(`SELECT id, sender_id, display_name, category, status, created_at FROM senders WHERE workspace_id = $1 ORDER BY created_at`, [ws]),
      pool.query(
        `SELECT r.id, r.display_name, r.legal_name, r.category, r.website, r.use_case, r.monthly_volume, r.status, r.note,
           r.created_at, r.updated_at, u.name AS requested_by
         FROM sender_requests r LEFT JOIN users u ON u.id = r.requested_by
         WHERE r.workspace_id = $1 ORDER BY r.created_at DESC`,
        [ws],
      ),
    ]);
    return {
      data: senders.rows,
      requests: requests.rows,
      default_sender: config.tc.senderId,
      contact: { name: config.senderContactName, email: config.senderContactEmail || null },
      can_manage: req.ctx.superAdmin,
    };
  });

  app.post('/v1/senders/requests', { preHandler: requirePermission('campaigns:manage') }, async (req, reply) => {
    const parsed = RequestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const r = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO sender_requests (workspace_id, requested_by, display_name, legal_name, category, website, use_case, monthly_volume)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at`,
      [req.ctx.workspaceId, req.ctx.userId, r.display_name, r.legal_name, r.category, r.website, r.use_case, r.monthly_volume],
    );
    await audit(req.ctx, 'sender.requested', { id: rows[0].id, display_name: r.display_name, category: r.category });
    req.log.info({ workspace: req.ctx.workspaceId, request: rows[0].id, display_name: r.display_name }, 'new sender request');
    return reply.code(201).send({ ...r, ...rows[0] });
  });

  // ---- OneXtel super admins only ----

  app.post('/v1/senders', { preHandler: superAdminOnly }, async (req, reply) => {
    const parsed = SenderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const s = parsed.data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO senders (workspace_id, sender_id, display_name, category) VALUES ($1, $2, $3, $4)
         RETURNING id, sender_id, display_name, category, status, created_at`,
        [req.ctx.workspaceId, s.sender_id, s.display_name, s.category],
      );
      await audit(req.ctx, 'sender.added', { sender_id: s.sender_id });
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'That sender is already added.' });
      throw err;
    }
  });

  app.patch('/v1/senders/:id', { preHandler: superAdminOnly }, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const b = z.object({ status: z.enum(['active', 'paused']) }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'status must be active or paused' });
    const { rows } = await pool.query(
      `UPDATE senders SET status = $3 WHERE id = $1 AND workspace_id = $2 RETURNING id, sender_id, display_name, category, status, created_at`,
      [p.data.id, req.ctx.workspaceId, b.data.status],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit(req.ctx, `sender.${b.data.status}`, { sender_id: rows[0].sender_id });
    return rows[0];
  });

  app.patch('/v1/senders/requests/:id', { preHandler: superAdminOnly }, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const b = z.object({ status: z.enum(['submitted', 'in_review', 'approved', 'rejected']), note: z.string().trim().max(500).optional() }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid status' });
    const { rows } = await pool.query(
      `UPDATE sender_requests SET status = $3, note = coalesce($4, note), updated_at = now()
       WHERE id = $1 AND workspace_id = $2 RETURNING id, status, note`,
      [p.data.id, req.ctx.workspaceId, b.data.status, b.data.note ?? null],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit(req.ctx, 'sender_request.updated', rows[0]);
    return rows[0];
  });
}

// A workspace with registered senders may only send from its active ones. One with none yet uses
// the platform default sender, so demos work before onboarding is done.
export async function checkSender(workspaceId: string, senderId: string | undefined) {
  const { rows } = await pool.query(`SELECT sender_id, status FROM senders WHERE workspace_id = $1`, [workspaceId]);
  if (!rows.length) return { senderId: senderId || config.tc.senderId };
  const active = rows.filter((r) => r.status === 'active').map((r) => r.sender_id as string);
  if (!active.length) return { error: 'All of this workspace\'s senders are paused.' };
  if (!senderId) return { senderId: active[0] };
  if (!active.includes(senderId)) return { error: `Sender "${senderId}" is not an active sender for this workspace.` };
  return { senderId };
}
