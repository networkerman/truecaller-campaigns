import { Fragment, useState } from 'react';
import { webhooks, type Webhook, type WebhookDelivery, type WebhookEvent, type WebhookInput } from './api';
import { Drawer, PageHead, useAsync, usePoll, when } from './ui';

const EVENT_HELP: Record<WebhookEvent, string> = {
  'message.sent': 'Truecaller accepted the message',
  'message.delivered': 'The message reached the phone',
  'message.read': 'The recipient opened it',
  'message.failed': 'The message could not be sent or delivered',
  'campaign.started': 'A campaign began sending',
  'campaign.completed': 'A campaign finished sending',
};
const ALL_EVENTS = Object.keys(EVENT_HELP) as WebhookEvent[];
const blank: WebhookInput = { url: '', description: '', events: ['message.delivered', 'message.failed'], enabled: true };

export function WebhooksPage() {
  const [data, setData] = useState<Webhook[] | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(6);
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [open, setOpen] = useState<Webhook | null>(null);
  const { error, run } = useAsync();
  const load = () =>
    run(() =>
      webhooks.all().then((r) => {
        setData(r.data);
        setMaxAttempts(r.max_attempts);
        setOpen((o) => (o ? r.data.find((w) => w.id === o.id) ?? null : o));
      }),
    );
  usePoll(load, 0, false);

  return (
    <>
      <PageHead
        title="Webhooks"
        sub="Get message and campaign events posted to your own system as they happen."
        action={<button className="btn primary" onClick={() => setEditing('new')}>Add endpoint</button>}
      />
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        {!data ? (
          <p className="empty">Loading webhooks…</p>
        ) : data.length === 0 ? (
          <div className="empty">
            <p>No endpoints yet. Add one to receive delivery and read updates without polling.</p>
            <button className="btn" onClick={() => setEditing('new')}>Add your first endpoint</button>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Endpoint</th><th>Events</th><th>Last delivered</th><th>Failed (24h)</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id} onClick={() => setOpen(w)}>
                  <td>
                    <div className="strong clip">{w.url}</div>
                    {w.description && <div className="muted small">{w.description}</div>}
                  </td>
                  <td className="muted small">{w.events.length === ALL_EVENTS.length ? 'All events' : w.events.join(', ')}</td>
                  <td className="muted">{w.last_delivered_at ? when(w.last_delivered_at) : 'Never'}</td>
                  <td className={w.failed_24h ? 'bad strong' : 'muted'}>{w.failed_24h}</td>
                  <td><span className={`status ${w.enabled ? 'st-approved' : 'st-draft'}`}>{w.enabled ? 'enabled' : 'disabled'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card pad docs">
        <h3>Verify each request</h3>
        <p className="hint">
          Every POST carries <code>x-onextel-signature: t=TIMESTAMP,v1=SIGNATURE</code>. SIGNATURE is the HMAC-SHA256 of
          <code>TIMESTAMP.RAW_BODY</code> using the endpoint's signing secret. Reply with any 2xx within 10 seconds. Anything
          else is retried up to {maxAttempts} times over about 8 hours.
        </p>
        <pre>{`import crypto from 'node:crypto';

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return fresh && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`}</pre>
      </section>

      {editing && (
        <EndpointForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(w) => (setEditing(null), load(), setOpen(w))}
        />
      )}
      {open && !editing && <EndpointDrawer hook={open} onClose={() => setOpen(null)} onEdit={() => setEditing(open)} onChanged={load} />}
    </>
  );
}

function EndpointForm({ initial, onClose, onSaved }: { initial: Webhook | null; onClose: () => void; onSaved: (w: Webhook) => void }) {
  const [form, setForm] = useState<WebhookInput>(initial ? { url: initial.url, description: initial.description, events: initial.events, enabled: initial.enabled } : blank);
  const { busy, error, run } = useAsync();
  const toggle = (e: WebhookEvent) =>
    setForm({ ...form, events: form.events.includes(e) ? form.events.filter((x) => x !== e) : [...form.events, e] });
  const save = () =>
    run(async () => {
      const body = { ...form, url: form.url.trim(), description: form.description.trim() };
      onSaved(initial ? await webhooks.update(initial.id, body) : await webhooks.create(body));
    });

  return (
    <Drawer
      title={initial ? 'Edit endpoint' : 'Add endpoint'}
      onClose={onClose}
      narrow
      footer={<><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !form.url.trim() || !form.events.length} onClick={save}>{initial ? 'Save' : 'Add endpoint'}</button></>}
    >
      <div className="form pad">
        <label>
          Endpoint URL
          <input className="input" autoFocus value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/webhooks/truecaller" />
          <span className="hint">Must use HTTPS. We send a JSON POST to this address.</span>
        </label>
        <label>
          Description <span className="hint">Optional</span>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. CRM delivery updates" />
        </label>
        <div className="label strong">Events to send</div>
        <div className="event-list">
          {ALL_EVENTS.map((e) => (
            <label key={e} className="inline">
              <input type="checkbox" checked={form.events.includes(e)} onChange={() => toggle(e)} />
              <code>{e}</code>
              <span className="hint">{EVENT_HELP[e]}</span>
            </label>
          ))}
        </div>
        <label className="inline">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Enabled
        </label>
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}

function EndpointDrawer({ hook, onClose, onEdit, onChanged }: { hook: Webhook; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<WebhookDelivery | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  const load = () => webhooks.deliveries(hook.id, filter || undefined).then(setRows);
  usePoll(load, 5000);

  const test = () => run(async () => (setResult(await webhooks.test(hook.id)), load(), onChanged()));
  const rotate = () =>
    confirm('Rotate the signing secret? The current one stops working straight away, so update your receiver right after.') &&
    run(async () => (await webhooks.rotate(hook.id), setShown(true), onChanged()));
  const remove = () => confirm('Delete this endpoint? Pending deliveries to it are dropped.') && run(async () => (await webhooks.remove(hook.id), onChanged(), onClose()));
  const retry = (d: WebhookDelivery) => run(async () => (await webhooks.retry(d.id), load(), onChanged()));
  const setFilterAndLoad = (f: string) => (setFilter(f), setRows(null), webhooks.deliveries(hook.id, f || undefined).then(setRows));

  return (
    <Drawer
      title={hook.description || 'Endpoint'}
      badge={<span className={`status ${hook.enabled ? 'st-approved' : 'st-draft'}`}>{hook.enabled ? 'enabled' : 'disabled'}</span>}
      onClose={onClose}
      footer={<><button className="btn danger-ghost" disabled={busy} onClick={remove}>Delete</button><div className="spacer" /><button className="btn" onClick={onEdit}>Edit</button><button className="btn primary" disabled={busy} onClick={test}>Send test event</button></>}
    >
      <div className="pad">
        <dl className="facts">
          <dt>URL</dt><dd><code>{hook.url}</code></dd>
          <dt>Events</dt><dd>{hook.events.join(', ')}</dd>
          <dt>Signing secret</dt>
          <dd>
            <div className="key-box">
              <code>{shown ? hook.secret : 'whsec_' + '•'.repeat(24)}</code>
              <button className="btn small" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Reveal'}</button>
              <button className="btn small" onClick={() => navigator.clipboard.writeText(hook.secret).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</button>
              <button className="btn small" disabled={busy} onClick={rotate}>Rotate</button>
            </div>
          </dd>
        </dl>
        {result && (
          <div className={`banner ${result.status === 'delivered' ? 'ok' : 'error'}`}>
            {result.status === 'delivered' ? `Test delivered. Your endpoint replied ${result.response_code}.` : `Test failed: ${result.last_error ?? 'no response'}`}
          </div>
        )}
        {error && <div className="banner error">{error}</div>}

        <div className="row-between toolbar">
          <h3>Recent deliveries</h3>
          <div className="tabs">
            {['', 'delivered', 'pending', 'failed'].map((f) => (
              <button key={f} className={`tab ${filter === f ? 'on' : ''}`} onClick={() => setFilterAndLoad(f)}>{f ? f[0].toUpperCase() + f.slice(1) : 'All'}</button>
            ))}
          </div>
        </div>
        <div className="card">
          {!rows ? (
            <p className="empty">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="empty">No deliveries{filter ? ` with status ${filter}` : ' yet. Send a test event to check your endpoint.'}</p>
          ) : (
            <table className="table compact">
              <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Response</th><th>Created</th><th /></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <Fragment key={d.id}>
                    <tr onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                      <td><code>{d.event}</code></td>
                      <td><span className={`status ${d.status === 'delivered' ? 'st-approved' : d.status === 'failed' ? 'st-rejected' : 'st-submitted'}`}>{d.status}</span></td>
                      <td>{d.attempts}</td>
                      <td className="small">
                        {d.response_code ?? '—'}
                        {d.last_error && <div className="bad clip">{d.last_error}</div>}
                        {d.next_attempt_at && <div className="muted">Next try {when(d.next_attempt_at)}</div>}
                      </td>
                      <td className="muted small">{when(d.created_at)}</td>
                      <td className="num">{d.status !== 'delivered' && <button className="btn small" disabled={busy} onClick={(e) => (e.stopPropagation(), retry(d))}>Retry</button>}</td>
                    </tr>
                    {expanded === d.id && (
                      <tr className="static"><td colSpan={6}><pre className="payload">{JSON.stringify(d.payload, null, 2)}</pre></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Drawer>
  );
}
