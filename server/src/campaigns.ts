import { config } from './config.js';
import { pool } from './db.js';
import { dispatch, logEvent } from './messages.js';
import type { MessagingProvider } from './providers/types.js';
import { render } from './templates.js';

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';

// Funnel counts are cumulative: a read message also counts as sent and delivered.
const STATS = `json_build_object(
    'queued',    count(*) FILTER (WHERE m.status IN ('queued', 'sending')),
    'sent',      count(*) FILTER (WHERE m.status IN ('sent', 'delivered', 'read')),
    'delivered', count(*) FILTER (WHERE m.status IN ('delivered', 'read')),
    'read',      count(*) FILTER (WHERE m.status = 'read'),
    'failed',    count(*) FILTER (WHERE m.status = 'failed'),
    'blocked',   count(*) FILTER (WHERE m.status = 'blocked')
  )`;

const SELECT = `SELECT c.id, c.name, c.template_id, t.name AS template_name, c.list_id, l.name AS list_name,
    c.sender_id, c.status, c.scheduled_at, c.started_at, c.completed_at, c.total, c.created_at, c.updated_at,
    (SELECT count(*)::int FROM contacts ct WHERE ct.list_id = c.list_id) AS list_size,
    (SELECT ${STATS} FROM messages m WHERE m.campaign_id = c.id) AS stats
  FROM campaigns c JOIN templates t ON t.id = c.template_id JOIN contact_lists l ON l.id = c.list_id`;

export async function listCampaigns() {
  return (await pool.query(`${SELECT} ORDER BY c.created_at DESC`)).rows;
}

export async function getCampaign(id: string) {
  return (await pool.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0] ?? null;
}

export interface CampaignInput {
  name: string;
  template_id: string;
  list_id: string;
  sender_id?: string;
}

// Checks the template can be sent to this list. Returns a reason when it can't.
export async function checkCampaign(input: CampaignInput) {
  const t = (await pool.query(`SELECT status, variables FROM templates WHERE id = $1`, [input.template_id])).rows[0];
  if (!t) return 'template not found';
  if (t.status !== 'approved') return `template is ${t.status}, not approved`;
  const l = (await pool.query(`SELECT columns FROM contact_lists WHERE id = $1`, [input.list_id])).rows[0];
  if (!l) return 'contact list not found';
  const missing = (t.variables as string[]).filter((v) => !(l.columns as string[]).includes(v));
  if (missing.length) return `the list has no column for: ${missing.join(', ')}`;
  return null;
}

export async function createCampaign(input: CampaignInput) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (name, template_id, list_id, sender_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.name, input.template_id, input.list_id, input.sender_id || config.tc.senderId],
  );
  return getCampaign(rows[0].id);
}

export async function updateCampaign(id: string, input: CampaignInput) {
  const res = await pool.query(
    `UPDATE campaigns SET name = $2, template_id = $3, list_id = $4, sender_id = $5, updated_at = now()
     WHERE id = $1 AND status = 'draft'`,
    [id, input.name, input.template_id, input.list_id, input.sender_id || config.tc.senderId],
  );
  return res.rowCount ? getCampaign(id) : null;
}

export async function deleteCampaign(id: string) {
  const res = await pool.query(`DELETE FROM campaigns WHERE id = $1 AND status = 'draft'`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// Moves a campaign between states. Returns null when the move isn't allowed from its current state.
export async function transition(id: string, to: CampaignStatus, from: CampaignStatus[], extra = '') {
  const res = await pool.query(
    `UPDATE campaigns SET status = $2, updated_at = now() ${extra} WHERE id = $1 AND status = ANY($3) RETURNING id`,
    [id, to, from],
  );
  return res.rowCount ? getCampaign(id) : null;
}

export async function schedule(id: string, at: Date) {
  const res = await pool.query(
    `UPDATE campaigns SET status = 'scheduled', scheduled_at = $2, updated_at = now()
     WHERE id = $1 AND status IN ('draft', 'scheduled') RETURNING id`,
    [id, at],
  );
  return res.rowCount ? getCampaign(id) : null;
}

export async function cancel(id: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE campaigns SET status = 'cancelled', completed_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('scheduled', 'running', 'paused') RETURNING id`,
      [id],
    );
    // Messages not yet handed to the provider are dropped; anything in flight finishes normally.
    if (res.rowCount) await client.query(`DELETE FROM messages WHERE campaign_id = $1 AND status = 'queued'`, [id]);
    await client.query('COMMIT');
    return res.rowCount ? getCampaign(id) : null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Starts a campaign: renders the template for every contact and queues the messages.
// The status change and the queueing happen in one transaction, so a campaign is only ever started once.
export async function start(id: string, providerName: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = (
      await client.query(
        `UPDATE campaigns SET status = 'running', started_at = now(), updated_at = now()
         WHERE id = $1 AND status IN ('draft', 'scheduled') RETURNING id, template_id, list_id, sender_id`,
        [id],
      )
    ).rows[0];
    if (!c) {
      await client.query('ROLLBACK');
      return null;
    }
    const t = (await client.query(`SELECT body, category FROM templates WHERE id = $1`, [c.template_id])).rows[0];
    const contacts = (await client.query(`SELECT phone, attrs FROM contacts WHERE list_id = $1 ORDER BY created_at, id`, [c.list_id])).rows;

    for (let i = 0; i < contacts.length; i += 1000) {
      const chunk = contacts.slice(i, i + 1000).map((ct) => {
        const out = render(t.body, ct.attrs);
        // A contact with an empty value for a variable is recorded as failed rather than sent half-filled.
        return 'error' in out
          ? { phone: ct.phone, body: t.body, status: 'failed', error: out.error }
          : { phone: ct.phone, body: out.text, status: 'queued', error: null };
      });
      await client.query(
        `INSERT INTO messages (to_number, sender_id, category, body, provider, template_id, campaign_id, status, error)
         SELECT p, $1, $2, b, $3, $4, $5, s, e FROM unnest($6::text[], $7::text[], $8::text[], $9::text[]) AS x(p, b, s, e)`,
        [
          c.sender_id, t.category, providerName, c.template_id, c.id,
          chunk.map((x) => x.phone), chunk.map((x) => x.body), chunk.map((x) => x.status), chunk.map((x) => x.error),
        ],
      );
    }
    await client.query(`UPDATE campaigns SET total = $2 WHERE id = $1`, [id, contacts.length]);
    await client.query('COMMIT');
    return getCampaign(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Background sender. Each tick starts due scheduled campaigns, sends a paced batch of queued
// messages from running ones, and closes campaigns with nothing left. Safe to run on several instances:
// messages are claimed with SKIP LOCKED, so each is sent once.
export function startWorker(provider: MessagingProvider, log: { error: (e: unknown, msg: string) => void }) {
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = await pool.query(`SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= now()`);
      for (const { id } of due.rows) await start(id, provider.name);

      const claimed = await pool.query(
        `UPDATE messages SET status = 'sending', updated_at = now()
         WHERE id IN (
           SELECT m.id FROM messages m JOIN campaigns c ON c.id = m.campaign_id
           WHERE m.status = 'queued' AND c.status = 'running'
           ORDER BY m.created_at LIMIT $1 FOR UPDATE OF m SKIP LOCKED)
         RETURNING id, to_number, sender_id, body`,
        [config.sendRatePerSecond],
      );
      await Promise.all(
        claimed.rows.map((m) => dispatch(provider, { id: m.id, to: m.to_number, senderId: m.sender_id, body: m.body })),
      );

      await pool.query(
        `UPDATE campaigns c SET status = 'completed', completed_at = now(), updated_at = now()
         WHERE c.status = 'running'
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = c.id AND m.status IN ('queued', 'sending'))`,
      );
    } catch (err) {
      log.error(err, 'campaign worker tick failed');
    } finally {
      busy = false;
    }
  };

  void recoverInterrupted().catch((err) => log.error(err, 'campaign worker recovery failed'));
  return setInterval(() => void tick(), 1000);
}

// A message left in 'sending' by a restart may or may not have reached the provider. Re-sending
// could message someone twice, so it is marked failed instead.
async function recoverInterrupted() {
  const { rows } = await pool.query(
    `UPDATE messages SET status = 'failed', error = 'interrupted before the send was confirmed', updated_at = now()
     WHERE status = 'sending' AND campaign_id IS NOT NULL AND updated_at < now() - interval '2 minutes'
     RETURNING id`,
  );
  for (const { id } of rows) await logEvent(id, 'failed', { error: 'interrupted' });
}
