import { pool } from './db.js';
import type { MessagingProvider, MessageStatus, StatusUpdate } from './providers/types.js';

const rank: Record<MessageStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4, blocked: 4 };

export interface NewMessage {
  to: string;
  senderId: string;
  category: string;
  body: string;
  templateId?: string;
  campaignId?: string;
  contactId?: string;
}

// Inserts a message row. Returns null when this campaign contact already has a message (another worker got it).
export async function insertMessage(
  provider: MessagingProvider,
  msg: NewMessage,
  status: MessageStatus = 'queued',
  error: string | null = null,
): Promise<string | null> {
  const { rows } = await pool.query(
    `INSERT INTO messages (to_number, sender_id, category, body, provider, template_id, campaign_id, contact_id, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (campaign_id, contact_id) WHERE campaign_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [msg.to, msg.senderId, msg.category, msg.body, provider.name, msg.templateId ?? null,
     msg.campaignId ?? null, msg.contactId ?? null, status, error],
  );
  if (!rows[0]) return null;
  await logEvent(rows[0].id, status, error ? { error } : null);
  return rows[0].id;
}

// Hands a queued message to the provider and records the outcome.
export async function deliver(provider: MessagingProvider, id: string, msg: NewMessage) {
  try {
    const res = await provider.send({ messageId: id, to: msg.to, senderId: msg.senderId, body: msg.body });
    await pool.query(
      `UPDATE messages SET provider_message_id = $2, status = $3, updated_at = now() WHERE id = $1`,
      [id, res.providerMessageId, res.status],
    );
    await logEvent(id, res.status, null);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await pool.query(`UPDATE messages SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [id, error]);
    await logEvent(id, 'failed', { error });
  }
}

export async function sendMessage(provider: MessagingProvider, msg: NewMessage) {
  const id = (await insertMessage(provider, msg))!;
  await deliver(provider, id, msg);
  return getMessage(id);
}

// Applies a delivery update. Late or out-of-order callbacks never move a message backwards.
export async function applyStatusUpdate(u: StatusUpdate) {
  const { rows } = await pool.query(`SELECT id, status FROM messages WHERE provider_message_id = $1`, [u.providerMessageId]);
  if (!rows[0]) return false;
  const { id, status } = rows[0] as { id: string; status: MessageStatus };
  await logEvent(id, u.status, u.raw ?? (u.error ? { error: u.error } : null));
  if (rank[u.status] > rank[status]) {
    await pool.query(`UPDATE messages SET status = $2, error = $3, updated_at = now() WHERE id = $1`, [id, u.status, u.error ?? null]);
  }
  return true;
}

export async function getMessage(id: string) {
  const { rows } = await pool.query(
    `SELECT id, to_number AS to, sender_id, category, template_id, campaign_id, body, status, error, created_at, updated_at
     FROM messages WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const events = await pool.query(`SELECT status, created_at FROM message_events WHERE message_id = $1 ORDER BY id`, [id]);
  return { ...rows[0], events: events.rows };
}

async function logEvent(messageId: string, status: string, payload: unknown) {
  await pool.query(`INSERT INTO message_events (message_id, status, payload) VALUES ($1, $2, $3)`, [
    messageId,
    status,
    payload === null ? null : JSON.stringify(payload),
  ]);
}
