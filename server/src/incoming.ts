import { emit, emitMessageEvent } from './customerWebhooks.js';
import { pool } from './db.js';

type Ev = Record<string, Record<string, unknown> | undefined>;

// Truecaller events that are not status receipts: replies from the person (messageSent, a quick-reply tap
// carries content.action_tag) and link-button taps (messageActionPerformed). Replies are stored and sent to
// the customer as `incoming`; link-button taps as a `delivery` event on the original message.
export async function handleUserEvents(body: unknown) {
  const events = Array.isArray((body as { events?: unknown })?.events) ? ((body as { events: Ev[] }).events) : [];
  for (const e of events) {
    if (e?.messageSent) await storeReply(e.messageSent);
    else if (e?.messageActionPerformed) await linkTap(e.messageActionPerformed);
  }
}

const original = async (providerId: unknown) => {
  if (typeof providerId !== 'string' || !providerId) return null;
  const { rows } = await pool.query(`SELECT id, workspace_id, campaign_id FROM messages WHERE provider_message_id = $1`, [providerId]);
  return rows[0] ?? null;
};

async function storeReply(m: Record<string, unknown>) {
  const content = (m.content ?? {}) as Record<string, unknown>;
  const ref = await original(content.refMessageId ?? content.ref_message_id);
  const from = String((m.sender as Record<string, unknown> | undefined)?.phoneNumber ?? (m.sender as Record<string, unknown> | undefined)?.value ?? '');
  const media = content.image ?? content.video ?? content.file ?? null;
  const at = Number(m.date) > 0 ? new Date(Number(m.date) * 1000) : new Date();
  // Replies without a referenced message are matched to the sender's latest message to that number.
  const target = ref ?? (from ? (await pool.query(
    `SELECT id, workspace_id, campaign_id FROM messages WHERE to_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [`+${from.replace(/\D/g, '')}`],
  )).rows[0] : null);
  const { rows } = await pool.query(
    `INSERT INTO incoming_messages (workspace_id, message_id, campaign_id, provider_id, from_number, text, action_tag, media, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (provider_id) DO NOTHING RETURNING id`,
    [target?.workspace_id ?? null, target?.id ?? null, target?.campaign_id ?? null, (m.messageId as string) ?? null, from,
     (content.text as string) ?? null, (content.action_tag as string) ?? null, media ? JSON.stringify(media) : null, at],
  );
  if (!rows[0] || !target) return;
  await emit(target.workspace_id, 'incoming', content.action_tag ? 'message.quick_reply' : 'message.reply', {
    message_id: target.id,
    campaign_id: target.campaign_id,
    from: from ? `+${from.replace(/\D/g, '')}` : null,
    text: content.text ?? null,
    ...(media ? { media } : {}),
    received_at: at.toISOString(),
  });
}

async function linkTap(a: Record<string, unknown>) {
  const ref = await original(a.refMessageId ?? a.ref_message_id);
  if (!ref) return;
  const tag = String(a.actionTag ?? a.action_tag ?? '');
  const { rows } = await pool.query(`SELECT label, url FROM links WHERE code = $1`, [tag.slice(1)]);
  await emitMessageEvent(ref.id, 'button_click', null, { button: rows[0]?.label ?? null, url: rows[0]?.url ?? null });
}
