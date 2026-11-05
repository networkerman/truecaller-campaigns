import { emitMessageEvent } from './customerWebhooks.js';
import { pool } from './db.js';
import { buildFallbackRequest, sendFallback, type FallbackStep, type SmsTemplate } from './onexaura.js';
import { getSettings } from './settings.js';

// Campaign fallback: when Truecaller fails or a message expires without a delivery report, the campaign's
// fallback chain sends it again on RCS, WhatsApp or SMS through the customer's OnexAura account. Each try is
// a fallback_attempts row; a failed try queues the next step of the chain.

// Truecaller failures that should fall back. Opt-outs, limits and missing values are skipped on purpose.
export const fallsBack = (error: string | null | undefined) => Boolean(error && /^Truecaller /.test(error));

// Queues the given step for a campaign message if its campaign has that step.
export async function queueFallback(messageId: string, step = 0) {
  await pool.query(
    `INSERT INTO fallback_attempts (message_id, campaign_id, step, channel)
     SELECT m.id, c.id, $2::int, c.fallback -> $2::int ->> 'channel'
     FROM messages m JOIN campaigns c ON c.id = m.campaign_id
     WHERE m.id = $1 AND jsonb_array_length(c.fallback) > $2::int
     ON CONFLICT (message_id, step) DO NOTHING`,
    [messageId, step],
  );
}

// Sends up to `limit` queued fallback messages. Several workers can share the queue.
export async function processFallbacks(limit = 50) {
  const { rows } = await pool.query(
    `UPDATE fallback_attempts SET status = 'sending', updated_at = now()
     WHERE id IN (SELECT id FROM fallback_attempts WHERE status = 'queued' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, message_id, step`,
    [limit],
  );
  for (const a of rows) await sendOne(a.id, a.message_id, a.step);
  return rows.length;
}

async function sendOne(attemptId: string, messageId: string, step: number) {
  const { rows } = await pool.query(
    `SELECT m.workspace_id, m.to_number, m.category, c.fallback, c.variable_defaults, t.variable_defaults AS template_defaults,
       coalesce(ct.attributes, '{}') AS attributes
     FROM messages m JOIN campaigns c ON c.id = m.campaign_id JOIN templates t ON t.id = c.template_id
     LEFT JOIN contacts ct ON ct.id = m.contact_id WHERE m.id = $1`,
    [messageId],
  );
  const m = rows[0];
  const chain = (m?.fallback ?? []) as FallbackStep[];
  const s = m && chain[step];
  if (!m || !s) return finish(attemptId, messageId, step, 'failed', null, 'Fallback step not found');
  const settings = await getSettings(m.workspace_id);
  const apiKey = settings.fallback.onexaura.api_key;
  if (!apiKey) return finish(attemptId, messageId, step, 'failed', null, 'No OnexAura API key in Settings');
  // Empty contact values fall back to the template's and campaign's defaults, as for the Truecaller send.
  const attrs: Record<string, string> = { ...m.template_defaults, ...m.variable_defaults };
  for (const [k, v] of Object.entries(m.attributes as Record<string, string>)) if (String(v ?? '').trim()) attrs[k] = String(v);
  let sms: SmsTemplate | undefined;
  if (s.channel === 'sms') {
    const t = await pool.query(`SELECT id, name, dlt_template_id, body FROM sms_templates WHERE id::text = $1 AND workspace_id = $2`, [s.template, m.workspace_id]);
    sms = t.rows[0];
    if (!sms) return finish(attemptId, messageId, step, 'failed', null, 'SMS template not found');
  }
  try {
    const res = await sendFallback(apiKey, buildFallbackRequest(settings, s, m.to_number, attrs, m.category, sms));
    if ('error' in res) return finish(attemptId, messageId, step, 'failed', null, res.error);
    return finish(attemptId, messageId, step, 'submitted', res.messageId, null);
  } catch (err) {
    return finish(attemptId, messageId, step, 'failed', null, `OnexAura: ${(err as Error).message}`);
  }
}

async function finish(attemptId: string, messageId: string, step: number, status: string, providerId: string | null, error: string | null) {
  const { rows } = await pool.query(
    `UPDATE fallback_attempts SET status = $2, provider_message_id = $3, error = $4, updated_at = now() WHERE id = $1 RETURNING channel`,
    [attemptId, status, providerId, error],
  );
  const channel = rows[0]?.channel;
  await emitMessageEvent(messageId, status === 'failed' ? 'fallback_failed' : 'fallback_submitted', error, { fallback_channel: channel, fallback_step: step });
  if (status === 'failed') await queueFallback(messageId, step + 1);
}

// A delivery report from OnexAura for a fallback message. Failures move on to the next step.
export async function applyFallbackReport(workspaceId: string, providerMessageId: string, status: 'delivered' | 'read' | 'failed', error?: string) {
  const rank: Record<string, number> = { queued: 0, sending: 0, submitted: 1, delivered: 2, read: 3, failed: 4 };
  const { rows } = await pool.query(
    `SELECT a.id, a.message_id, a.step, a.status, a.channel FROM fallback_attempts a JOIN messages m ON m.id = a.message_id
     WHERE a.provider_message_id = $1 AND m.workspace_id = $2`,
    [providerMessageId, workspaceId],
  );
  const a = rows[0];
  if (!a || rank[status] <= rank[a.status] || a.status === 'failed') return false;
  await pool.query(`UPDATE fallback_attempts SET status = $2, error = $3, updated_at = now() WHERE id = $1`, [a.id, status, error ?? null]);
  await emitMessageEvent(a.message_id, `fallback_${status}`, error, { fallback_channel: a.channel, fallback_step: a.step });
  if (status === 'failed') await queueFallback(a.message_id, a.step + 1);
  return true;
}

// Marks sent messages that passed their expiry with no delivery report as expired, and starts their fallback.
export async function expireMessages(limit = 500) {
  const { rows } = await pool.query(
    `UPDATE messages SET status = 'expired', error = 'No delivery report before expiry', updated_at = now()
     WHERE id IN (SELECT id FROM messages WHERE status = 'sent' AND expires_at <= now() LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
    [limit],
  );
  for (const { id } of rows) {
    await pool.query(`INSERT INTO message_events (message_id, status, payload) VALUES ($1, 'expired', NULL)`, [id]);
    await emitMessageEvent(id, 'expired', 'No delivery report before expiry');
    await queueFallback(id);
  }
  return rows.length;
}
