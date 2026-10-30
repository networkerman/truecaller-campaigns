import { guardrails, sendRate } from './config.js';
import { pool } from './db.js';
import { deliver, insertMessage, type NewMessage } from './messages.js';
import type { MessagingProvider } from './providers/types.js';
import { emitCampaignEvent } from './customerWebhooks.js';
import { saveLinks, trackLinks } from './links.js';
import { render } from './templates.js';

// Truecaller counts days in Indian time.
const TODAY_IST = `date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
const COUNTED = `status NOT IN ('blocked', 'failed')`;

const STATS = `
  count(m.id)::int AS processed,
  count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read'))::int AS sent,
  count(m.id) FILTER (WHERE m.status IN ('delivered', 'read'))::int AS delivered,
  count(m.id) FILTER (WHERE m.status = 'read')::int AS read,
  count(m.id) FILTER (WHERE m.status = 'failed')::int AS failed,
  count(m.id) FILTER (WHERE m.status = 'blocked')::int AS blocked,
  count(m.id) FILTER (WHERE m.status = 'queued')::int AS queued`;

const SELECT_CAMPAIGN = `
  SELECT c.*, t.name AS template_name, t.category, t.body AS template_body, t.status AS template_status,
    l.name AS list_name, (SELECT count(*)::int FROM contacts WHERE list_id = c.list_id) AS recipients, ${STATS}
  FROM campaigns c
  JOIN templates t ON t.id = c.template_id
  JOIN contact_lists l ON l.id = c.list_id
  LEFT JOIN messages m ON m.campaign_id = c.id`;

export async function listCampaigns(ws: string) {
  return (await pool.query(`${SELECT_CAMPAIGN} WHERE c.workspace_id = $1 GROUP BY c.id, t.id, l.id ORDER BY c.created_at DESC`, [ws])).rows;
}

export async function getCampaign(ws: string, id: string) {
  return (await pool.query(`${SELECT_CAMPAIGN} WHERE c.id = $1 AND c.workspace_id = $2 GROUP BY c.id, t.id, l.id`, [id, ws])).rows[0] ?? null;
}

export async function createCampaign(
  ws: string,
  c: { name: string; templateId: string; listId: string; senderId: string; variableDefaults?: Record<string, string>; trackLinks?: boolean },
) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (workspace_id, name, template_id, list_id, sender_id, variable_defaults, track_links)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ws, c.name, c.templateId, c.listId, c.senderId, c.variableDefaults ?? {}, c.trackLinks ?? true],
  );
  return getCampaign(ws, rows[0].id);
}

export async function launchCampaign(ws: string, id: string, scheduledAt: Date | null) {
  const c = await getCampaign(ws, id);
  if (!c) return { status: 404, error: 'not found' };
  if (c.status !== 'draft') return { status: 409, error: `campaign is already ${c.status}` };
  if (c.template_status !== 'approved') return { status: 400, error: 'the template must be approved before launch' };
  if (!c.recipients) return { status: 400, error: 'the contact list is empty' };
  const later = scheduledAt && scheduledAt.getTime() > Date.now();
  await pool.query(
    `UPDATE campaigns SET status = $2, scheduled_at = $3, started_at = $4, updated_at = now() WHERE id = $1`,
    [id, later ? 'scheduled' : 'running', later ? scheduledAt : null, later ? null : new Date()],
  );
  if (!later) await emitCampaignEvent(id, 'campaign.started');
  return { campaign: await getCampaign(ws, id) };
}

export async function cancelCampaign(ws: string, id: string) {
  const { rows } = await pool.query(
    `UPDATE campaigns SET status = 'cancelled', completed_at = now(), note = NULL, updated_at = now()
     WHERE id = $1 AND workspace_id = $2 AND status IN ('scheduled', 'running') RETURNING id`,
    [id, ws],
  );
  return rows[0] ? getCampaign(ws, id) : null;
}

export async function campaignReport(ws: string, id: string) {
  const c = await getCampaign(ws, id);
  if (!c) return null;
  const reasons = await pool.query(
    `SELECT status, coalesce(error, 'Unknown') AS reason, count(*)::int AS count
     FROM messages WHERE campaign_id = $1 AND status IN ('failed', 'blocked')
     GROUP BY 1, 2 ORDER BY count DESC`,
    [id],
  );
  const timeline = await pool.query(
    `SELECT date_trunc('minute', created_at) AS minute, count(*)::int AS processed
     FROM messages WHERE campaign_id = $1 GROUP BY 1 ORDER BY 1`,
    [id],
  );
  // Seconds from the send being accepted to the first receipt of each kind, and to the first link click.
  const timing = await pool.query(
    `WITH t AS (
       SELECT m.id,
         min(e.created_at) FILTER (WHERE e.status = 'sent') AS sent_at,
         min(e.created_at) FILTER (WHERE e.status = 'delivered') AS delivered_at,
         min(e.created_at) FILTER (WHERE e.status = 'read') AS read_at,
         (SELECT min(first_clicked_at) FROM links l WHERE l.message_id = m.id) AS clicked_at
       FROM messages m JOIN message_events e ON e.message_id = m.id
       WHERE m.campaign_id = $1 GROUP BY m.id
     ), d AS (
       SELECT extract(epoch FROM delivered_at - sent_at) AS deliver_s,
              extract(epoch FROM read_at - sent_at) AS read_s,
              extract(epoch FROM clicked_at - sent_at) AS click_s,
              clicked_at IS NOT NULL AS clicked
       FROM t WHERE sent_at IS NOT NULL
     )
     SELECT avg(deliver_s) AS avg_deliver, percentile_cont(0.5) WITHIN GROUP (ORDER BY deliver_s) AS median_deliver,
            avg(read_s) AS avg_read, percentile_cont(0.5) WITHIN GROUP (ORDER BY read_s) AS median_read,
            avg(click_s) AS avg_click, percentile_cont(0.5) WITHIN GROUP (ORDER BY click_s) AS median_click,
            count(*) FILTER (WHERE clicked)::int AS clicked
     FROM d`,
    [id],
  );
  const clicks = await pool.query(
    `SELECT count(*)::int AS links, coalesce(sum(clicks), 0)::int AS total FROM links WHERE campaign_id = $1`,
    [id],
  );
  const tm = timing.rows[0];
  const secs = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  const clicked = tm.clicked as number;
  const hasLinks = clicks.rows[0].links > 0;

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    campaign: c,
    funnel: [
      { stage: 'Recipients', count: c.recipients },
      { stage: 'Sent', count: c.sent },
      { stage: 'Delivered', count: c.delivered },
      { stage: 'Read', count: c.read },
      ...(hasLinks ? [{ stage: 'Clicked', count: clicked }] : []),
      { stage: 'Failed', count: c.failed, bad: true },
      { stage: 'Skipped', count: c.blocked, bad: true },
    ],
    rates: {
      delivery_rate: pct(c.delivered, c.sent),
      read_rate: pct(c.read, c.delivered),
      click_rate: hasLinks ? pct(clicked, c.delivered) : null,
      failure_rate: pct(c.failed, c.processed),
      blocked_rate: pct(c.blocked, c.processed),
    },
    timing: {
      avg_deliver_s: secs(tm.avg_deliver), median_deliver_s: secs(tm.median_deliver),
      avg_read_s: secs(tm.avg_read), median_read_s: secs(tm.median_read),
      avg_click_s: secs(tm.avg_click), median_click_s: secs(tm.median_click),
    },
    clicks: { tracked: hasLinks, unique: clicked, total: clicks.rows[0].total },
    reasons: reasons.rows.map((r) => ({ ...r, category: categorize(r.reason) })),
    categories: groupReasons(reasons.rows),
    timeline: timeline.rows,
  };
}

// Failure and skip reasons grouped into the few buckets people act on.
const CATEGORIES: { key: string; label: string; hint: string; test: RegExp }[] = [
  { key: 'not_on_truecaller', label: 'Not on Truecaller', hint: 'The number has no Truecaller account or chat is off.', test: /NOT_FOUND/ },
  { key: 'opted_out', label: 'Opted out', hint: 'The person asked not to get these messages.', test: /^Opted out/ },
  { key: 'frequency_limit', label: 'Frequency limits', hint: 'Promotional caps per person or per sender.', test: /^Limit:|Daily promotional limit/ },
  { key: 'missing_value', label: 'Missing personalisation', hint: 'A {{variable}} had no value in the list and no default.', test: /^missing values for/ },
  { key: 'invalid_number', label: 'Invalid number', hint: 'Truecaller rejected the number format.', test: /INVALID_ARGUMENT|invalid phone/i },
  { key: 'sender_auth', label: 'Sender or key problem', hint: 'The Truecaller key or sender is wrong or not allowed.', test: /UNAUTHENTICATED|PERMISSION_DENIED|No Truecaller API key/ },
  { key: 'rate_limited', label: 'Rate limited by Truecaller', hint: 'Sending too fast for the sender.', test: /RESOURCE_EXHAUSTED/ },
  { key: 'provider_down', label: 'Truecaller unavailable', hint: 'Timeouts or errors on the Truecaller side. Safe to retry later.', test: /UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|UNKNOWN/ },
];

export function categorize(reason: string) {
  return CATEGORIES.find((c) => c.test.test(reason))?.key ?? 'other';
}

function groupReasons(rows: { status: string; reason: string; count: number }[]) {
  const out = new Map<string, { key: string; label: string; hint: string; count: number; reasons: { status: string; reason: string; count: number }[] }>();
  for (const r of rows) {
    const key = categorize(r.reason);
    const def = CATEGORIES.find((c) => c.key === key) ?? { key: 'other', label: 'Other', hint: 'Anything not listed above.' };
    const g = out.get(key) ?? { key, label: def.label, hint: def.hint, count: 0, reasons: [] };
    g.count += r.count;
    g.reasons.push(r);
    out.set(key, g);
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

export async function campaignMessagesCsv(id: string) {
  const { rows } = await pool.query(
    `SELECT to_number, status, coalesce(error, '') AS error, body, created_at, updated_at
     FROM messages WHERE campaign_id = $1 ORDER BY created_at`,
    [id],
  );
  const esc = (v: unknown) => `"${String(v instanceof Date ? v.toISOString() : v).replace(/"/g, '""')}"`;
  return [
    'phone,status,error,error_category,message,created_at,updated_at',
    ...rows.map((r) => [r.to_number, r.status, r.error, r.error ? categorize(r.error) : '', r.body, r.created_at, r.updated_at].map(esc).join(',')),
  ].join('\n');
}

// ---- Sender ----

let ticking = false;

// One pass of the campaign sender: starts due scheduled campaigns, then sends the next batch of each running one.
export async function tick(provider: MessagingProvider, batchSize = sendRate) {
  if (ticking) return;
  ticking = true;
  try {
    const { rows: started } = await pool.query(
      `UPDATE campaigns SET status = 'running', started_at = now(), updated_at = now()
       WHERE status = 'scheduled' AND scheduled_at <= now() RETURNING id`,
    );
    for (const { id } of started) await emitCampaignEvent(id, 'campaign.started');
    const { rows } = await pool.query(`SELECT id FROM campaigns WHERE status = 'running' ORDER BY started_at`);
    for (const { id } of rows) await sendBatch(provider, id, batchSize);
  } finally {
    ticking = false;
  }
}

async function setNote(id: string, note: string | null) {
  await pool.query(`UPDATE campaigns SET note = $2, updated_at = now() WHERE id = $1 AND note IS DISTINCT FROM $2`, [id, note]);
}

async function sendBatch(provider: MessagingProvider, campaignId: string, batchSize: number) {
  const { rows: cr } = await pool.query(
    `SELECT c.id, c.workspace_id, c.list_id, c.sender_id, c.template_id, t.body, t.category, c.track_links,
       t.variable_defaults || c.variable_defaults AS defaults
     FROM campaigns c JOIN templates t ON t.id = c.template_id WHERE c.id = $1 AND c.status = 'running'`,
    [campaignId],
  );
  const c = cr[0];
  if (!c) return;
  const promo = c.category === 'promotional';

  let room = batchSize;
  if (promo) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM messages
       WHERE sender_id = $1 AND category = 'promotional' AND ${COUNTED} AND created_at >= ${TODAY_IST}`,
      [c.sender_id],
    );
    room = Math.min(batchSize, guardrails.promoDailySenderLimit - rows[0].n);
    if (room <= 0) {
      await setNote(c.id, `Daily promotional limit of ${guardrails.promoDailySenderLimit.toLocaleString('en-IN')} reached for sender ${c.sender_id}. Resumes tomorrow.`);
      return;
    }
  }

  const { rows: batch } = await pool.query(
    `SELECT ct.id, ct.phone, ct.attributes, (o.phone IS NOT NULL) AS opted_out
     FROM contacts ct
     LEFT JOIN opt_outs o ON o.phone = ct.phone AND o.workspace_id = $4
     WHERE ct.list_id = $1
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = $2 AND m.contact_id = ct.id)
     ORDER BY ct.created_at, ct.id LIMIT $3`,
    [c.list_id, c.id, room, c.workspace_id],
  );

  if (batch.length === 0) {
    const pending = await pool.query(`SELECT 1 FROM messages WHERE campaign_id = $1 AND status = 'queued' LIMIT 1`, [c.id]);
    if (!pending.rowCount) {
      const done = await pool.query(
        `UPDATE campaigns SET status = 'completed', completed_at = now(), note = NULL, updated_at = now()
         WHERE id = $1 AND status = 'running'`,
        [c.id],
      );
      if (done.rowCount) await emitCampaignEvent(c.id, 'campaign.completed');
    }
    return;
  }
  await setNote(c.id, null);

  // Frequency caps for promo traffic, counted for the whole batch in two queries and kept current as we send.
  const perSender = new Map<string, number>();
  const perDay = new Map<string, number>();
  if (promo) {
    const phones = batch.map((b) => b.phone);
    const s = await pool.query(
      `SELECT to_number, count(*)::int AS n FROM messages
       WHERE to_number = ANY($1) AND sender_id = $2 AND category = 'promotional' AND ${COUNTED}
         AND created_at > now() - interval '28 days' GROUP BY 1`,
      [phones, c.sender_id],
    );
    s.rows.forEach((r) => perSender.set(r.to_number, r.n));
    const d = await pool.query(
      `SELECT to_number, count(*)::int AS n FROM messages
       WHERE to_number = ANY($1) AND category = 'promotional' AND ${COUNTED} AND created_at >= ${TODAY_IST} GROUP BY 1`,
      [phones],
    );
    d.rows.forEach((r) => perDay.set(r.to_number, r.n));
  }

  const toSend: { id: string; msg: NewMessage }[] = [];
  for (const ct of batch) {
    const base = { workspaceId: c.workspace_id, to: ct.phone, senderId: c.sender_id, category: c.category, templateId: c.template_id, campaignId: c.id, contactId: ct.id };
    const out = render(c.body, ct.attributes ?? {}, c.defaults ?? {});

    let blocked: string | null = null;
    if (ct.opted_out) blocked = 'Opted out';
    else if (promo && (perSender.get(ct.phone) ?? 0) >= guardrails.promoPerSenderReceiver28d)
      blocked = `Limit: ${guardrails.promoPerSenderReceiver28d} promo messages per sender in 28 days`;
    else if (promo && (perDay.get(ct.phone) ?? 0) >= guardrails.promoPerUserPerDay)
      blocked = `Limit: ${guardrails.promoPerUserPerDay} promo messages per user per day`;

    if (blocked) {
      await insertMessage(provider, { ...base, body: 'error' in out ? c.body : out.text }, 'blocked', blocked);
    } else if ('error' in out) {
      await insertMessage(provider, { ...base, body: c.body }, 'failed', out.error);
    } else {
      const tracked = c.track_links ? trackLinks(out.text) : { text: out.text, links: [] };
      const msg = { ...base, body: tracked.text };
      const id = await insertMessage(provider, msg);
      if (id) {
        await saveLinks(id, c.id, tracked.links);
        toSend.push({ id, msg });
        perSender.set(ct.phone, (perSender.get(ct.phone) ?? 0) + 1);
        perDay.set(ct.phone, (perDay.get(ct.phone) ?? 0) + 1);
      }
    }
  }

  for (let i = 0; i < toSend.length; i += 10) {
    await Promise.all(toSend.slice(i, i + 10).map((s) => deliver(provider, s.id, s.msg)));
  }
}
