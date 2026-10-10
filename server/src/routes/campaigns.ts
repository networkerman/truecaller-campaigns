import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiKey } from '../auth.js';
import {
  cancel,
  checkCampaign,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  schedule,
  start,
  transition,
  updateCampaign,
} from '../campaigns.js';
import type { MessagingProvider } from '../providers/types.js';

const CampaignBody = z.object({
  name: z.string().trim().min(1).max(100),
  template_id: z.string().uuid(),
  list_id: z.string().uuid(),
  sender_id: z.string().trim().max(50).optional(),
});
const Launch = z.object({ scheduled_at: z.string().datetime({ offset: true }).optional() });
const Id = z.object({ id: z.string().uuid() });

export async function campaignRoutes(app: FastifyInstance, opts: { provider: MessagingProvider }) {
  app.addHook('onRequest', requireApiKey);

  app.get('/v1/campaigns', async () => ({ data: await listCampaigns() }));

  app.post('/v1/campaigns', async (req, reply) => {
    const parsed = CampaignBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    const problem = await checkCampaign(parsed.data);
    if (problem) return reply.code(400).send({ error: problem });
    return reply.code(201).send(await createCampaign(parsed.data));
  });

  app.get('/v1/campaigns/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const c = p.success ? await getCampaign(p.data.id) : null;
    return c ?? reply.code(404).send({ error: 'not found' });
  });

  app.put('/v1/campaigns/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const parsed = CampaignBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    const problem = await checkCampaign(parsed.data);
    if (problem) return reply.code(400).send({ error: problem });
    return (await updateCampaign(p.data.id, parsed.data)) ?? reply.code(409).send({ error: 'only draft campaigns can be edited' });
  });

  app.delete('/v1/campaigns/:id', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    return (await deleteCampaign(p.data.id)) ? reply.code(204).send() : reply.code(409).send({ error: 'only draft campaigns can be deleted' });
  });

  // Starts now, or at scheduled_at. Re-checks the template and list, since either may have changed since the draft.
  app.post('/v1/campaigns/:id/launch', async (req, reply) => {
    const p = Id.safeParse(req.params);
    const c = p.success ? await getCampaign(p.data.id) : null;
    if (!c) return reply.code(404).send({ error: 'not found' });
    const body = Launch.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'scheduled_at must be an ISO date-time', details: body.error.issues });
    if (c.status !== 'draft' && c.status !== 'scheduled') return reply.code(409).send({ error: `campaign is already ${c.status}` });
    const problem = await checkCampaign(c);
    if (problem) return reply.code(400).send({ error: problem });
    if (!c.list_size) return reply.code(400).send({ error: 'the contact list is empty' });

    if (body.data.scheduled_at) {
      const at = new Date(body.data.scheduled_at);
      if (at.getTime() < Date.now() - 60_000) return reply.code(400).send({ error: 'scheduled time is in the past' });
      return schedule(c.id, at);
    }
    return (await start(c.id, opts.provider.name)) ?? reply.code(409).send({ error: 'campaign was started already' });
  });

  app.post('/v1/campaigns/:id/pause', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    return (await transition(p.data.id, 'paused', ['running'])) ?? reply.code(409).send({ error: 'only running campaigns can be paused' });
  });

  app.post('/v1/campaigns/:id/resume', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    return (await transition(p.data.id, 'running', ['paused'])) ?? reply.code(409).send({ error: 'only paused campaigns can be resumed' });
  });

  // Unschedules a scheduled campaign back to draft.
  app.post('/v1/campaigns/:id/unschedule', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    return (
      (await transition(p.data.id, 'draft', ['scheduled'], ', scheduled_at = NULL')) ??
      reply.code(409).send({ error: 'only scheduled campaigns can be unscheduled' })
    );
  });

  app.post('/v1/campaigns/:id/cancel', async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    return (await cancel(p.data.id)) ?? reply.code(409).send({ error: 'campaign has already finished or was never launched' });
  });
}
