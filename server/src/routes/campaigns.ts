import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  campaignMessagesCsv,
  campaignReport,
  cancelCampaign,
  createCampaign,
  getCampaign,
  launchCampaign,
  listCampaigns,
  tick,
} from '../campaigns.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import type { MessagingProvider } from '../providers/types.js';

const Id = z.object({ id: z.string().uuid() });
const CreateBody = z.object({
  name: z.string().trim().min(1).max(100),
  template_id: z.string().uuid(),
  list_id: z.string().uuid(),
  sender_id: z.string().trim().min(1).max(50).optional(),
  // Optional: launch straight away (now, or at scheduled_at) instead of saving a draft.
  launch: z.boolean().default(false),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
});

export async function campaignRoutes(app: FastifyInstance, opts: { provider: MessagingProvider; sender: boolean }) {
  app.addHook('onRequest', requireAuth);
  // When the sender runs in this process, start the first batch right away instead of waiting for the next tick.
  const kick = () => {
    if (opts.sender) void tick(opts.provider).catch((err) => app.log.error(err, 'campaign tick failed'));
  };

  app.get('/v1/campaigns', async () => ({ data: await listCampaigns() }));

  app.post('/v1/campaigns', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    const b = parsed.data;
    const refs = await pool.query(
      `SELECT (SELECT 1 FROM templates WHERE id = $1) AS t, (SELECT 1 FROM contact_lists WHERE id = $2) AS l`,
      [b.template_id, b.list_id],
    );
    if (!refs.rows[0].t) return reply.code(400).send({ error: 'template not found' });
    if (!refs.rows[0].l) return reply.code(400).send({ error: 'contact list not found' });

    const c = await createCampaign({ name: b.name, templateId: b.template_id, listId: b.list_id, senderId: b.sender_id ?? config.tc.senderId });
    if (!b.launch) return reply.code(201).send(c);
    const res = await launchCampaign(c.id, b.scheduled_at ? new Date(b.scheduled_at) : null);
    if ('error' in res) return reply.code(res.status!).send({ error: res.error, campaign: c });
    kick();
    return reply.code(201).send(res.campaign);
  });

  app.get('/v1/campaigns/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const c = p.success ? await getCampaign(p.data.id) : null;
    return c ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/v1/campaigns/:id/launch', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const body = z.object({ scheduled_at: z.string().datetime({ offset: true }).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'scheduled_at must be an ISO date-time' });
    const res = await launchCampaign(p.data.id, body.data.scheduled_at ? new Date(body.data.scheduled_at) : null);
    if ('error' in res) return reply.code(res.status!).send({ error: res.error });
    kick();
    return res.campaign;
  });

  app.post('/v1/campaigns/:id/cancel', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const c = p.success ? await cancelCampaign(p.data.id) : null;
    return c ?? reply.code(409).send({ error: 'only scheduled or running campaigns can be cancelled' });
  });

  app.delete('/v1/campaigns/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const { rowCount } = await pool.query(`DELETE FROM campaigns WHERE id = $1 AND status = 'draft'`, [p.data.id]);
    return rowCount ? reply.code(204).send() : reply.code(409).send({ error: 'only draft campaigns can be deleted' });
  });

  app.get('/v1/campaigns/:id/report', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const r = p.success ? await campaignReport(p.data.id) : null;
    return r ?? reply.code(404).send({ error: 'not found' });
  });

  app.get('/v1/campaigns/:id/messages.csv', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success || !(await getCampaign(p.data.id))) return reply.code(404).send({ error: 'not found' });
    return reply
      .header('content-type', 'text/csv')
      .header('content-disposition', `attachment; filename="campaign-${p.data.id}.csv"`)
      .send(await campaignMessagesCsv(p.data.id));
  });
}
