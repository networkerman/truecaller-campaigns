import type { FastifyInstance } from 'fastify';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { config } from '../config.js';
import { getMessage, sendMessage } from '../messages.js';
import type { MessagingProvider } from '../providers/types.js';

const SendBody = z.object({
  to: z.string(),
  body: z.string().min(1).max(1000),
  sender_id: z.string().optional(),
  category: z.enum(['promotional', 'transactional', 'service']).default('transactional'),
});

export async function messageRoutes(app: FastifyInstance, opts: { provider: MessagingProvider }) {
  app.addHook('onRequest', async (req, reply) => {
    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || !config.apiKeys.includes(key)) {
      return reply.code(401).send({ error: 'invalid or missing x-api-key' });
    }
  });

  app.post('/v1/messages', async (req, reply) => {
    const parsed = SendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues });

    // Bare 10-digit numbers are treated as Indian, the first market.
    const phone = parsePhoneNumberFromString(parsed.data.to, 'IN');
    if (!phone?.isValid()) return reply.code(400).send({ error: 'invalid phone number' });

    const msg = await sendMessage(opts.provider, {
      to: phone.number,
      senderId: parsed.data.sender_id ?? config.tc.senderId,
      category: parsed.data.category,
      body: parsed.data.body,
    });
    return reply.code(202).send(msg);
  });

  app.get<{ Params: { id: string } }>('/v1/messages/:id', async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'not found' });
    const msg = await getMessage(req.params.id);
    return msg ?? reply.code(404).send({ error: 'not found' });
  });
}
