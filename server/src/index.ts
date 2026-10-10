import Fastify from 'fastify';
import { tick } from './campaigns.js';
import { config, runMode } from './config.js';
import { pool } from './db.js';
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
const sender = runMode !== 'api';

const provider =
  config.provider === 'truecaller'
    ? createTruecallerProvider()
    : createMockProvider(async (u) => {
        await applyStatusUpdate(u).catch((err) => app.log.error(err, 'mock status update failed'));
      });

if (runMode !== 'worker') {
  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, provider: provider.name };
  });
  await app.register(messageRoutes, { provider });
  await app.register(templateRoutes);
  await app.register(listRoutes);
  await app.register(campaignRoutes, { provider, sender });
  await app.register(apiKeyRoutes);
  await app.register(webhookRoutes, { provider });
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

if (sender) {
  // Campaign sender: one batch per second per running campaign. Runs on an always-on
  // worker in production, because App Runner throttles CPU between requests.
  app.log.info({ runMode }, 'campaign sender started');
  let current: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    current = tick(provider).catch((err) => app.log.error(err, 'campaign tick failed'));
  }, 1000);

  const stop = async () => {
    clearInterval(timer);
    await current;
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
