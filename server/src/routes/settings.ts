import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAuth, requirePermission } from '../auth.js';
import { pool } from '../db.js';
import { applyFallbackReport } from '../fallback.js';
import { fetchTemplates, parseOnexauraCallback } from '../onexaura.js';
import { getSettings, publicSettings, saveSettings, workspaceForCallbackToken } from '../settings.js';

const VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const SmsTemplateBody = z.object({
  name: z.string().trim().min(1).max(100),
  dlt_template_id: z.string().trim().regex(/^\d{10,25}$/, 'DLT template ID is a number of 10 to 25 digits'),
  body: z.string().trim().min(1).max(1000),
});
const Id = z.object({ id: z.string().uuid() });

// Workspace settings (send window, frequency cap, defaults, fallback channels) and the SMS fallback templates.
export async function settingsRoutes(app: FastifyInstance) {
  app.register(async (priv) => {
    priv.addHook('onRequest', requireAuth);
    const view = { preHandler: requirePermission('reports:view') };
    const admin = { preHandler: requirePermission('members:manage') };
    const manage = { preHandler: requirePermission('campaigns:manage') };

    priv.get('/v1/settings', view, async (req) => publicSettings(await getSettings(req.ctx.workspaceId)));

    priv.put('/v1/settings', admin, async (req, reply) => {
      const res = await saveSettings(req.ctx.workspaceId, req.body);
      if ('error' in res) return reply.code(400).send({ error: res.error });
      await audit(req.ctx, 'settings.updated', null);
      return publicSettings(res.settings!);
    });

    // Templates from the customer's OnexAura account for the fallback picker.
    priv.get('/v1/fallback/templates', manage, async (req, reply) => {
      const channel = (req.query as { channel?: string }).channel;
      if (channel !== 'rcs' && channel !== 'whatsapp') return reply.code(400).send({ error: 'channel must be rcs or whatsapp' });
      const s = await getSettings(req.ctx.workspaceId);
      if (!s.fallback.onexaura.api_key) return reply.code(400).send({ error: 'Add the OnexAura API key in Settings first.' });
      if (channel === 'rcs' && !s.fallback.rcs.bot_id) return reply.code(400).send({ error: 'Add the RCS bot ID in Settings first.' });
      if (channel === 'whatsapp' && !s.fallback.whatsapp.waba_id) return reply.code(400).send({ error: 'Add the WhatsApp WABA ID in Settings first.' });
      try {
        return await fetchTemplates(s, channel);
      } catch (err) {
        return reply.code(502).send({ error: `Could not reach OnexAura: ${(err as Error).message}` });
      }
    });

    priv.get('/v1/sms-templates', view, async (req) => ({
      data: (await pool.query(
        `SELECT id, name, dlt_template_id, body, variables, created_at FROM sms_templates WHERE workspace_id = $1 ORDER BY name`,
        [req.ctx.workspaceId],
      )).rows,
    }));

    priv.post('/v1/sms-templates', manage, async (req, reply) => {
      const p = SmsTemplateBody.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'invalid template' });
      const vars = [...new Set([...p.data.body.matchAll(VAR)].map((m) => m[1]))];
      try {
        const { rows } = await pool.query(
          `INSERT INTO sms_templates (workspace_id, name, dlt_template_id, body, variables) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, dlt_template_id, body, variables, created_at`,
          [req.ctx.workspaceId, p.data.name, p.data.dlt_template_id, p.data.body, vars],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'An SMS template with this name exists.' });
        throw err;
      }
    });

    priv.delete('/v1/sms-templates/:id', manage, async (req, reply) => {
      const p = Id.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not found' });
      const { rowCount } = await pool.query(`DELETE FROM sms_templates WHERE id = $1 AND workspace_id = $2`, [p.data.id, req.ctx.workspaceId]);
      return rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
    });
  });

  // Public: OnexAura posts delivery reports for fallback messages here (set as the customer's OnexAura callback).
  app.post('/webhooks/onexaura/:token', async (req, reply) => {
    const ws = await workspaceForCallbackToken((req.params as { token: string }).token);
    if (!ws) return reply.code(404).send({ error: 'unknown callback' });
    let applied = 0;
    for (const u of parseOnexauraCallback(req.body)) {
      if (u.status && (await applyFallbackReport(ws, u.providerMessageId, u.status, u.error))) applied++;
    }
    return { received: applied };
  });
}
