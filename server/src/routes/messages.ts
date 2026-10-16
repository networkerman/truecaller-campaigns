import type { FastifyInstance } from 'fastify';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth.js';
import { config } from '../config.js';
import { getMessage, sendMessage } from '../messages.js';
import type { MessagingProvider } from '../providers/types.js';
import { getTemplate, render } from '../templates.js';

// Either a free-text body, or an approved template plus its variable values.
const SendBody = z
  .object({
    to: z.string(),
    sender_id: z.string().optional(),
    body: z.string().min(1).max(1000).optional(),
    category: z.enum(['promotional', 'transactional', 'service']).default('transactional'),
    template_id: z.string().uuid().optional(),
    variables: z.record(z.string(), z.string()).default({}),
  })
  .refine((b) => Boolean(b.body) !== Boolean(b.template_id), { message: 'send either body or template_id' });

export async function messageRoutes(app: FastifyInstance, opts: { provider: MessagingProvider }) {
  app.addHook('onRequest', requireAuth);

  app.post('/v1/messages', { preHandler: requirePermission('campaigns:manage') }, async (req, reply) => {
    const parsed = SendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });
    const data = parsed.data;

    // Bare 10-digit numbers are treated as Indian, the first market.
    const phone = parsePhoneNumberFromString(data.to, 'IN');
    if (!phone?.isValid()) return reply.code(400).send({ error: 'invalid phone number' });

    let body = data.body ?? '';
    let category: string = data.category;
    if (data.template_id) {
      const t = await getTemplate(req.ctx.workspaceId, data.template_id);
      if (!t) return reply.code(400).send({ error: 'template not found' });
      if (t.status !== 'approved') return reply.code(400).send({ error: `template is ${t.status}, not approved` });
      const out = render(t.body, data.variables);
      if ('error' in out) return reply.code(400).send(out);
      body = out.text;
      category = t.category;
    }

    const msg = await sendMessage(opts.provider, {
      workspaceId: req.ctx.workspaceId,
      to: phone.number,
      senderId: data.sender_id ?? config.tc.senderId,
      category,
      body,
      templateId: data.template_id,
    });
    return reply.code(202).send(msg);
  });

  app.get<{ Params: { id: string } }>('/v1/messages/:id', { preHandler: requirePermission('reports:view') }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'not found' });
    const msg = await getMessage(req.ctx.workspaceId, req.params.id);
    return msg ?? reply.code(404).send({ error: 'not found' });
  });
}
