import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, requireAuth, requirePermission } from '../auth.js';
import { config, guardrails } from '../config.js';
import { pool } from '../db.js';
import { sendNotice } from '../mailer.js';

const Id = z.object({ id: z.string().uuid() });
const category = z.enum(['promotional', 'transactional', 'service']);
const RequestBody = z.object({
  display_name: z.string().trim().min(2, 'Enter the name people will see').max(60),
  legal_name: z.string().trim().min(2, 'Enter the registered business name').max(200),
  category,
  website: z.string().trim().max(300).default(''),
  use_case: z.string().trim().min(10, 'Describe what you will send, in a sentence or two').max(1000),
  monthly_volume: z.string().trim().max(50).default(''),
  sample_message: z.string().trim().max(1000).default(''),
  contact_email: z.union([z.literal(''), z.string().trim().email('Enter a valid contact email')]).default(''),
});
const SenderBody = z.object({
  sender_id: z.string().trim().min(2).max(64),
  display_name: z.string().trim().min(2).max(60),
  category,
  tier: z.number().int().min(1).max(5).default(1),
  daily_limit: z.number().int().positive().nullable().default(null),
  // The request this sender fulfils: it is marked approved and the requester is told.
  request_id: z.string().uuid().optional(),
});
const SENDER_COLUMNS = 'id, sender_id, display_name, category, status, tier, daily_limit, request_id, created_at';
const STATUS_TEXT: Record<string, string> = {
  submitted: 'is pending with our onboarding team',
  in_review: 'is being reviewed with Truecaller',
  approved: 'is approved and the sender is live',
  rejected: 'was not approved',
};
const refOf = (n: number) => `SR-${n}`;

// Who handles sender onboarding: SENDER_REQUEST_EMAILS, else the contact email, else the super admins.
const onboardingTeam = () =>
  config.senderRequestEmails.length ? config.senderRequestEmails : config.senderContactEmail ? [config.senderContactEmail] : config.superAdminEmails;

// Last 7 days of traffic per sender in this workspace, plus today's promotional count against the daily limit.
// Truecaller's API has no tier or health lookup, so health comes from what we have sent.
async function senderHealth(ws: string, senderIds: string[]) {
  if (!senderIds.length) return new Map<string, Record<string, unknown>>();
  const { rows } = await pool.query(
    `SELECT sender_id,
       count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read'))::int AS sent,
       count(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS delivered,
       count(*) FILTER (WHERE status = 'read')::int AS read,
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'failed' AND error LIKE '%NOT_FOUND%')::int AS not_on_truecaller,
       count(*) FILTER (WHERE category = 'promotional' AND status NOT IN ('blocked', 'failed')
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int AS promo_today,
       max(created_at) AS last_sent_at
     FROM messages WHERE workspace_id = $1 AND sender_id = ANY($2) AND created_at > now() - interval '7 days'
     GROUP BY sender_id`,
    [ws, senderIds],
  );
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return new Map(
    rows.map((r) => {
      const attempted = r.sent + r.failed;
      const delivery = pct(r.delivered, r.sent);
      // Unreachable numbers are a list problem, not a sender one, so they don't count against health.
      const realFailures = pct(r.failed - r.not_on_truecaller, attempted);
      const health = attempted < 20 || delivery === null ? 'not_enough_data'
        : delivery >= 80 && (realFailures ?? 0) < 5 ? 'good'
        : delivery >= 60 && (realFailures ?? 0) < 15 ? 'watch' : 'poor';
      return [r.sender_id, { ...r, delivery_rate: delivery, read_rate: pct(r.read, r.delivered), unreachable_rate: pct(r.not_on_truecaller, attempted), health }];
    }),
  );
}

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
      pool.query(`SELECT ${SENDER_COLUMNS} FROM senders WHERE workspace_id = $1 ORDER BY created_at`, [ws]),
      pool.query(
        `SELECT r.id, 'SR-' || r.ref AS ref, r.display_name, r.legal_name, r.category, r.website, r.use_case, r.monthly_volume,
           r.sample_message, r.contact_email, r.status, r.note, r.sender_id, r.created_at, r.updated_at, u.name AS requested_by
         FROM sender_requests r LEFT JOIN users u ON u.id = r.requested_by
         WHERE r.workspace_id = $1 ORDER BY r.created_at DESC`,
        [ws],
      ),
    ]);
    const ids = senders.rows.length ? senders.rows.map((r) => r.sender_id) : [config.tc.senderId];
    const health = await senderHealth(ws, ids);
    const limitOf = (l: number | null) => l ?? guardrails.promoDailySenderLimit;
    return {
      data: senders.rows.map((r) => ({
        ...r,
        effective_daily_limit: limitOf(r.daily_limit),
        stats: health.get(r.sender_id) ?? null,
        // Super admins see which senders still need a Truecaller key on the server.
        ...(req.ctx.superAdmin ? { has_credential: Boolean(config.tc.senderKeys[r.sender_id] || config.tc.apiKey) } : {}),
      })),
      requests: requests.rows,
      default_sender: config.tc.senderId,
      default_sender_stats: senders.rows.length ? null : health.get(config.tc.senderId) ?? null,
      default_daily_limit: guardrails.promoDailySenderLimit,
      contact: { name: config.senderContactName, email: config.senderContactEmail || null },
      can_manage: req.ctx.superAdmin,
    };
  });

  app.post('/v1/senders/requests', { preHandler: requirePermission('campaigns:manage') }, async (req, reply) => {
    const parsed = RequestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const r = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO sender_requests (workspace_id, requested_by, display_name, legal_name, category, website, use_case, monthly_volume, sample_message, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, ref, status, created_at`,
      [req.ctx.workspaceId, req.ctx.userId, r.display_name, r.legal_name, r.category, r.website, r.use_case, r.monthly_volume, r.sample_message, r.contact_email],
    );
    const ref = refOf(rows[0].ref);
    await audit(req.ctx, 'sender.requested', { id: rows[0].id, ref, display_name: r.display_name, category: r.category });
    req.log.info({ workspace: req.ctx.workspaceId, request: rows[0].id, ref, display_name: r.display_name }, 'new sender request');

    const who = await requester(rows[0].id);
    const sendersUrl = `${config.publicUrl}/#/senders`;
    void sendNotice(req.log, {
      to: onboardingTeam(),
      subject: `New sender request ${ref}: ${r.display_name} (${who?.workspace_name ?? 'workspace'})`,
      text: [
        `${who?.name ?? 'Someone'} (${who?.email ?? 'API key'}) requested a Truecaller sender for ${who?.workspace_name}.`,
        '',
        `Reference: ${ref}`,
        `Display name: ${r.display_name}`,
        `Registered business name: ${r.legal_name}`,
        `Category: ${r.category}`,
        `Website: ${r.website || '-'}`,
        `Expected monthly volume: ${r.monthly_volume || '-'}`,
        `Contact: ${r.contact_email || who?.email || '-'}`,
        '',
        `What they will send:\n${r.use_case}`,
        ...(r.sample_message ? ['', `Sample message:\n${r.sample_message}`] : []),
        '',
        `Open the workspace's Senders page to move it to In review, then add the sender once Truecaller verifies it: ${sendersUrl}`,
      ].join('\n'),
    });
    void sendNotice(req.log, {
      to: [who?.email ?? '', r.contact_email],
      subject: `We got your sender request ${ref}`,
      text: `Hi ${who?.name ?? 'there'},\n\nThanks. Your request for the sender "${r.display_name}" is pending with our onboarding team. ` +
        `We'll check the details, register it with Truecaller and email you at each step. Verification usually takes a few working days.\n\n` +
        `Track it on the Senders page: ${sendersUrl}\n`,
    });
    return reply.code(201).send({ ...r, ...rows[0], ref });
  });

  // ---- OneXtel super admins only ----

  app.post('/v1/senders', { preHandler: superAdminOnly }, async (req, reply) => {
    const parsed = SenderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const s = parsed.data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO senders (workspace_id, sender_id, display_name, category, tier, daily_limit, request_id)
         VALUES ($1, $2, $3, $4, $5, $6,
           (SELECT id FROM sender_requests WHERE id = $7 AND workspace_id = $1))
         RETURNING ${SENDER_COLUMNS}`,
        [req.ctx.workspaceId, s.sender_id, s.display_name, s.category, s.tier, s.daily_limit, s.request_id ?? null],
      );
      await audit(req.ctx, 'sender.added', { sender_id: s.sender_id, request_id: rows[0].request_id });
      if (rows[0].request_id) {
        await pool.query(
          `UPDATE sender_requests SET status = 'approved', sender_id = $2, updated_at = now() WHERE id = $1`,
          [rows[0].request_id, rows[0].id],
        );
        await notifyRequester(req.log, rows[0].request_id, `Sender ID: ${s.sender_id}. You can pick it when creating a campaign.`);
      }
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'That sender is already added.' });
      throw err;
    }
  });

  app.patch('/v1/senders/:id', { preHandler: superAdminOnly }, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const b = z.object({
      status: z.enum(['active', 'paused']).optional(),
      tier: z.number().int().min(1).max(5).optional(),
      daily_limit: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'status must be active or paused; tier 1 to 5; daily_limit a positive number or null' });
    const { rows } = await pool.query(
      `UPDATE senders SET status = coalesce($3, status), tier = coalesce($4, tier),
         daily_limit = CASE WHEN $5::boolean THEN $6 ELSE daily_limit END
       WHERE id = $1 AND workspace_id = $2 RETURNING ${SENDER_COLUMNS}`,
      [p.data.id, req.ctx.workspaceId, b.data.status ?? null, b.data.tier ?? null, b.data.daily_limit !== undefined, b.data.daily_limit ?? null],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit(req.ctx, b.data.status ? `sender.${b.data.status}` : 'sender.updated', { sender_id: rows[0].sender_id, ...b.data });
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
    await notifyRequester(req.log, rows[0].id, null);
    return rows[0];
  });
}

async function requester(requestId: string) {
  const { rows } = await pool.query(
    `SELECT r.ref, r.display_name, r.status, r.note, r.contact_email, u.email, u.name, w.name AS workspace_name
     FROM sender_requests r JOIN workspaces w ON w.id = r.workspace_id LEFT JOIN users u ON u.id = r.requested_by
     WHERE r.id = $1`,
    [requestId],
  );
  return rows[0] ?? null;
}

// Emails whoever filed the request (and its contact email) about its current status.
async function notifyRequester(log: FastifyRequest['log'], requestId: string, extra: string | null) {
  const r = await requester(requestId);
  if (!r) return;
  const ref = refOf(r.ref);
  await sendNotice(log, {
    to: [r.email ?? '', r.contact_email],
    subject: `Sender request ${ref} (${r.display_name}): ${label(r.status)}`,
    text: [
      `Hi ${r.name ?? 'there'},`,
      '',
      `Your request ${ref} for the sender "${r.display_name}" ${STATUS_TEXT[r.status] ?? r.status}.`,
      ...(r.note ? ['', `Note from OneXtel: ${r.note}`] : []),
      ...(extra ? ['', extra] : []),
      '',
      `Senders page: ${config.publicUrl}/#/senders`,
    ].join('\n'),
  });
}

const label = (s: string) => ({ submitted: 'Pending', in_review: 'In review', approved: 'Approved', rejected: 'Not approved' })[s] ?? s;

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
