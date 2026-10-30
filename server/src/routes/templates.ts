import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth.js';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  render,
  setTemplateStatus,
  updateTemplate,
} from '../templates.js';

const TemplateBody = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(['promotional', 'transactional', 'service']),
  body: z.string().trim().min(1).max(1000),
});
const Id = z.object({ id: z.string().uuid() });

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  const manage = { preHandler: requirePermission('templates:manage') };
  const view = { preHandler: requirePermission('reports:view') };

  app.get('/v1/templates', view, async (req) => ({ data: await listTemplates(req.ctx.workspaceId) }));

  app.post('/v1/templates', manage, async (req, reply) => {
    const parsed = TemplateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    try {
      return reply.code(201).send(await createTemplate(req.ctx.workspaceId, parsed.data));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'a template with this name exists' });
      throw err;
    }
  });

  app.get('/v1/templates/:id', view, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const t = p.success ? await getTemplate(req.ctx.workspaceId, p.data.id) : null;
    return t ?? reply.code(404).send({ error: 'not found' });
  });

  app.put('/v1/templates/:id', manage, async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const parsed = TemplateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    try {
      return (await updateTemplate(req.ctx.workspaceId, p.data.id, parsed.data)) ?? reply.code(404).send({ error: 'not found' });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'a template with this name exists' });
      throw err;
    }
  });

  app.delete('/v1/templates/:id', manage, async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    const res = await deleteTemplate(req.ctx.workspaceId, p.data.id);
    if (res === 'not_found') return reply.code(404).send({ error: 'not found' });
    if (res === 'in_use') return reply.code(409).send({ error: 'template has been used to send messages and cannot be deleted' });
    return reply.code(204).send();
  });

  // Submits for approval. Approved straight away: Truecaller Business Chat v2 sends free text and has
  // no template review, so there is nothing to wait for on either provider.
  app.post('/v1/templates/:id/submit', manage, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const t = p.success ? await getTemplate(req.ctx.workspaceId, p.data.id) : null;
    if (!t) return reply.code(404).send({ error: 'not found' });
    if (t.status !== 'draft' && t.status !== 'rejected') {
      return reply.code(409).send({ error: `template is already ${t.status}` });
    }
    return setTemplateStatus(t.id, 'approved');
  });

  app.post('/v1/templates/:id/preview', view, async (req, reply) => {
    const p = Id.safeParse(req.params);
    const t = p.success ? await getTemplate(req.ctx.workspaceId, p.data.id) : null;
    if (!t) return reply.code(404).send({ error: 'not found' });
    const values = z.record(z.string(), z.string()).safeParse((req.body as { values?: unknown } | undefined)?.values ?? {});
    if (!values.success) return reply.code(400).send({ error: 'values must be an object of strings' });
    const out = render(t.body, values.data);
    return 'error' in out ? reply.code(400).send(out) : out;
  });
}
