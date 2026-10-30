import Fastify from 'fastify';
import { tick } from './campaigns.js';
import { dispatchDue } from './customerWebhooks.js';
import { config, runMode } from './config.js';
import { pool } from './db.js';
import { applyStatusUpdate } from './messages.js';
import { createMockProvider } from './providers/mock.js';
import { createTruecallerProvider } from './providers/truecaller.js';
import { bootstrapSuperAdmins } from './team.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { authRoutes } from './routes/auth.js';
import { campaignRoutes } from './routes/campaigns.js';
import { customerWebhookRoutes } from './routes/customerWebhooks.js';
import { linkRoutes } from './routes/links.js';
import { listRoutes } from './routes/lists.js';
import { mediaRoutes } from './routes/media.js';
import { messageRoutes } from './routes/messages.js';
import { senderRoutes } from './routes/senders.js';
import { teamRoutes } from './routes/team.js';
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
  await app.register(authRoutes);
  await app.register(messageRoutes, { provider });
  await app.register(templateRoutes);
  await app.register(listRoutes);
  await app.register(campaignRoutes, { provider, sender });
  await app.register(apiKeyRoutes);
  await app.register(teamRoutes);
  await app.register(customerWebhookRoutes);
  await app.register(senderRoutes);
  await app.register(webhookRoutes, { provider });
  await app.register(linkRoutes);
  await app.register(mediaRoutes);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  await bootstrapSuperAdmins(app.log);
}

if (sender) {
  // Campaign sender: one batch per second per running campaign. In production this is the
  // always-on worker container, so scheduled campaigns start on time with nobody on the dashboard.
  app.log.info({ runMode }, 'campaign sender started');
  let current: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    current = tick(provider).catch((err) => app.log.error(err, 'campaign tick failed'));
  }, 1000);

  // Customer webhooks: send what is due every 2 seconds, retrying failures with backoff.
  let hooks: Promise<unknown> = Promise.resolve();
  let hooksBusy = false;
  const hookTimer = setInterval(() => {
    if (hooksBusy) return;
    hooksBusy = true;
    hooks = dispatchDue()
      .catch((err) => app.log.error(err, 'webhook dispatch failed'))
      .finally(() => (hooksBusy = false));
  }, 2000);

  const stop = async () => {
    clearInterval(timer);
    clearInterval(hookTimer);
    await Promise.all([current, hooks]);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
