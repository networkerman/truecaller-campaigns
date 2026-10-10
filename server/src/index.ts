import Fastify from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';
import { startWorker } from './campaigns.js';
import { applyStatusUpdate } from './messages.js';
import { createMockProvider } from './providers/mock.js';
import { createTruecallerProvider } from './providers/truecaller.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { campaignRoutes } from './routes/campaigns.js';
import { listRoutes } from './routes/lists.js';
import { messageRoutes } from './routes/messages.js';
import { templateRoutes } from './routes/templates.js';
import { webhookRoutes } from './routes/webhooks.js';

const app = Fastify({ logger: true });

const provider =
  config.provider === 'truecaller'
    ? createTruecallerProvider()
    : createMockProvider(async (u) => {
        await applyStatusUpdate(u).catch((err) => app.log.error(err, 'mock status update failed'));
      });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true, provider: provider.name };
});
await app.register(messageRoutes, { provider });
await app.register(templateRoutes);
await app.register(webhookRoutes, { provider });
await app.register(listRoutes);
await app.register(campaignRoutes, { provider });
await app.register(apiKeyRoutes);

await app.listen({ port: config.port, host: '0.0.0.0' });
startWorker(provider, app.log);
