import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { applyStatusUpdate } from '../messages.js';
import type { MessagingProvider } from '../providers/types.js';

export async function webhookRoutes(app: FastifyInstance, opts: { provider: MessagingProvider }) {
  app.post('/webhooks/truecaller', async (req, reply) => {
    // Exact signing scheme depends on the Truecaller spec; a shared secret header covers the POC.
    if (config.tc.webhookSecret && req.headers['x-webhook-secret'] !== config.tc.webhookSecret) {
      return reply.code(401).send({ error: 'bad signature' });
    }
    const updates = opts.provider.parseWebhook(req.body);
    for (const u of updates) await applyStatusUpdate(u);
    return { received: updates.length };
  });
}
