import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db.js';
import { postJson } from './sources.js';

// Events a customer can subscribe to. Message events follow the message's status; campaign
// events fire when a campaign starts sending and when it finishes.
export const EVENTS = [
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'campaign.started',
  'campaign.completed',
] as const;
export type WebhookEvent = (typeof EVENTS)[number];

export const MAX_ENDPOINTS = 5;
// Wait before attempt 2, 3, 4, 5, 6. After the sixth failure the delivery is marked failed.
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;

export const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

// Stripe-style signature: HMAC-SHA256 over "<timestamp>.<raw body>" with the endpoint secret.
export function sign(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// Queues an event for every enabled endpoint in the workspace that subscribed to it.
export async function emit(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const payload = { id: `evt_${randomUUID()}`, type: event, created_at: new Date().toISOString(), data };
  await pool.query(
    `INSERT INTO webhook_deliveries (endpoint_id, event, payload)
     SELECT id, $2, $3 FROM webhook_endpoints WHERE workspace_id = $1 AND enabled AND $2 = ANY(events)`,
    [workspaceId, event, JSON.stringify(payload)],
  );
}

// Message events carry what a customer needs to match them to their own send.
export async function emitMessageEvent(messageId: string, status: string, error?: string | null) {
  const event = `message.${status}` as WebhookEvent;
  if (!EVENTS.includes(event)) return;
  const { rows } = await pool.query(
    `SELECT workspace_id, id, to_number, sender_id, campaign_id, template_id FROM messages WHERE id = $1`,
    [messageId],
  );
  const m = rows[0];
  if (!m) return;
  await emit(m.workspace_id, event, {
    message_id: m.id,
    to: m.to_number,
    sender_id: m.sender_id,
    campaign_id: m.campaign_id,
    template_id: m.template_id,
    status,
    ...(error ? { error } : {}),
  });
}

export async function emitCampaignEvent(campaignId: string, event: 'campaign.started' | 'campaign.completed') {
  const { rows } = await pool.query(
    `SELECT c.workspace_id, c.id, c.name, c.status, c.started_at, c.completed_at,
       (SELECT count(*)::int FROM messages WHERE campaign_id = c.id) AS processed
     FROM campaigns c WHERE c.id = $1`,
    [campaignId],
  );
  const c = rows[0];
  if (!c) return;
  await emit(c.workspace_id, event, {
    campaign_id: c.id,
    name: c.name,
    status: c.status,
    started_at: c.started_at,
    completed_at: c.completed_at,
    processed: c.processed,
  });
}

// Sends one delivery and records the outcome. Used by the worker loop, Send test and Retry.
export async function attempt(deliveryId: string) {
  const { rows } = await pool.query(
    `SELECT d.id, d.event, d.payload, d.attempts, e.url, e.secret
     FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.id = $1`,
    [deliveryId],
  );
  const d = rows[0];
  if (!d) return null;
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  const attempts = d.attempts + 1;
  let code: number | null = null;
  let error: string | null = null;
  try {
    const res = await postJson(
      d.url,
      body,
      {
        'x-onextel-event': d.event,
        'x-onextel-delivery': d.id,
        'x-onextel-signature': `t=${ts},v1=${sign(d.secret, ts, body)}`,
      },
      config.webhookAllowPrivate,
    );
    code = res.status;
    if (code < 200 || code >= 300) error = `HTTP ${code}${res.body ? `: ${res.body.slice(0, 200)}` : ''}`;
  } catch (err) {
    error = (err as Error).message;
  }

  const ok = !error;
  const giveUp = !ok && attempts >= MAX_ATTEMPTS;
  const wait = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
  const { rows: out } = await pool.query(
    `UPDATE webhook_deliveries SET attempts = $2, response_code = $3, last_error = $4,
       status = $5, delivered_at = CASE WHEN $5 = 'delivered' THEN now() END,
       next_attempt_at = now() + make_interval(secs => $6)
     WHERE id = $1
     RETURNING id, event, status, attempts, response_code, last_error, created_at, delivered_at, next_attempt_at`,
    [d.id, attempts, code, error, ok ? 'delivered' : giveUp ? 'failed' : 'pending', wait],
  );
  return out[0];
}

// Worker loop: sends up to 20 due deliveries. SKIP LOCKED lets several workers share the queue.
export async function dispatchDue() {
  const { rows } = await pool.query(
    `UPDATE webhook_deliveries SET next_attempt_at = now() + interval '2 minutes'
     WHERE id IN (SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now()
                  ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
  );
  await Promise.all(rows.map((r) => attempt(r.id)));
  return rows.length;
}
