import { useState } from 'react';
import { senders, type Category, type Sender, type SenderRequest, type SenderRequestInput, type SendersResponse, type SenderStats } from './api';
import { Drawer, PageHead, fmt, useAsync, usePoll, when } from './ui';

const CATEGORIES: Category[] = ['transactional', 'service', 'promotional'];
const REQUEST_STATUS: SenderRequest['status'][] = ['submitted', 'in_review', 'approved', 'rejected'];
// What customers see: a request is "Pending" until OneXtel picks it up.
const STATUS_LABEL: Record<SenderRequest['status'], string> = { submitted: 'Pending', in_review: 'In review', approved: 'Approved', rejected: 'Not approved' };
const HEALTH: Record<SenderStats['health'], { label: string; cls: string; hint: string }> = {
  good: { label: 'Healthy', cls: 'st-approved', hint: 'Delivery 80% or more and few real failures.' },
  watch: { label: 'Watch', cls: 'rq-submitted', hint: 'Delivery between 60% and 80%, or some failures. Check the lists you are sending to.' },
  poor: { label: 'Poor', cls: 'rq-rejected', hint: 'Delivery under 60% or many failures. Talk to your account manager.' },
  not_enough_data: { label: 'Not enough data', cls: 'st-draft', hint: 'Fewer than 20 messages in the last 7 days.' },
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const blankRequest: SenderRequestInput = {
  display_name: '', legal_name: '', category: 'transactional', website: '', use_case: '', monthly_volume: '', sample_message: '', contact_email: '',
};

// A sender is the verified business profile people see in Truecaller. OneXtel registers each one
// with Truecaller by hand, so customers request them here and a OneXtel admin adds them when live.
export function SendersPage({ canRequest }: { canRequest: boolean }) {
  const [data, setData] = useState<SendersResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [adding, setAdding] = useState<SenderRequest | 'blank' | null>(null);
  const [editing, setEditing] = useState<Sender | null>(null);
  const { busy, error, run } = useAsync();
  const load = () => run(() => senders.all().then(setData));
  usePoll(load, 0, false);

  const toggle = (id: string, status: 'active' | 'paused') => run(() => senders.setStatus(id, status).then(load));
  const setRequestStatus = (r: SenderRequest, status: SenderRequest['status']) => {
    const note = status === 'rejected' || status === 'in_review' ? prompt('Note for the customer (optional, included in the email)', r.note ?? '') : undefined;
    if (note === null) return;
    run(() => senders.setRequestStatus(r.id, status, note || undefined).then(load));
  };
  const contact = data?.contact;
  const open = data?.requests.filter((r) => r.status === 'submitted' || r.status === 'in_review').length ?? 0;

  return (
    <>
      <PageHead
        title="Senders"
        sub="The verified business profile people see when your message arrives in Truecaller."
        action={canRequest && <button className="btn primary" onClick={() => setRequesting(true)}>Request a sender</button>}
      />
      {error && <div className="banner error">{error}</div>}

      {contact && (
        <div className="banner info-note">
          Senders are registered with Truecaller by {contact.name}
          {contact.email && <> at <a href={`mailto:${contact.email}`}>{contact.email}</a></>}. Request one here and
          you'll get an email at each step. Verification usually takes a few working days.
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Active senders</h3>
          {data?.can_manage && <button className="btn small" onClick={() => setAdding('blank')}>Add sender</button>}
        </div>
        {!data ? (
          <p className="empty">Loading senders…</p>
        ) : data.data.length === 0 ? (
          <div className="pad">
            <p className="muted">No senders registered for this workspace yet. Campaigns go out from the platform default sender.</p>
            <div className="sender-grid">
              <SenderCard name="Platform default" senderId={data.default_sender} category={null} tier={null}
                limit={data.default_daily_limit} stats={data.default_sender_stats} />
            </div>
          </div>
        ) : (
          <div className="sender-grid pad">
            {data.data.map((s) => (
              <SenderCard key={s.id} name={s.display_name} senderId={s.sender_id} category={s.category} tier={s.tier}
                limit={s.effective_daily_limit} stats={s.stats} paused={s.status === 'paused'}
                warn={s.has_credential === false ? 'No Truecaller key on the server yet' : null}
                actions={data.can_manage && (
                  <>
                    <button className="btn small" disabled={busy} onClick={() => setEditing(s)}>Tier and limit</button>
                    <button className="btn small" disabled={busy} onClick={() => toggle(s.id, s.status === 'active' ? 'paused' : 'active')}>
                      {s.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                  </>
                )} />
            ))}
          </div>
        )}
      </div>

      {data && data.requests.length > 0 && (
        <div className="card section">
          <div className="card-head">
            <h3>Requests</h3>
            {open > 0 && <span className="status rq-submitted">{open} pending</span>}
          </div>
          <table className="table">
            <thead><tr><th>Request</th><th>Category</th><th>Requested</th><th>Status</th>{data.can_manage && <th />}</tr></thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id} className="static">
                  <td>
                    <div><code>{r.ref}</code> <span className="strong">{r.display_name}</span></div>
                    <div className="muted small">{r.legal_name}{r.website && ` · ${r.website}`}</div>
                    <div className="small clip" title={r.use_case}>{r.use_case}</div>
                    {r.sample_message && <div className="small clip muted" title={r.sample_message}>Sample: {r.sample_message}</div>}
                  </td>
                  <td><span className={`chip cat-${r.category}`}>{r.category}</span></td>
                  <td className="muted small">{when(r.created_at)}{r.requested_by && <div>by {r.requested_by}</div>}</td>
                  <td>
                    {data.can_manage && r.status !== 'approved' ? (
                      <select className="input role-select" value={r.status} disabled={busy} onChange={(e) => setRequestStatus(r, e.target.value as SenderRequest['status'])}>
                        {REQUEST_STATUS.filter((s) => s !== 'approved').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : (
                      <span className={`status rq-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    )}
                    {r.note && <div className="muted small">{r.note}</div>}
                  </td>
                  {data.can_manage && (
                    <td className="num">
                      {r.status !== 'approved' && r.status !== 'rejected' && (
                        <button className="btn small primary" disabled={busy} onClick={() => setAdding(r)}>Create sender</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requesting && <RequestWizard onClose={() => setRequesting(false)} onDone={() => (setRequesting(false), load())} />}
      {adding && <AddSender request={adding === 'blank' ? null : adding} onClose={() => setAdding(null)} onDone={() => (setAdding(null), load())} />}
      {editing && <EditLimits sender={editing} onClose={() => setEditing(null)} onDone={() => (setEditing(null), load())} />}
    </>
  );
}

function SenderCard({ name, senderId, category, tier, limit, stats, paused, warn, actions }: {
  name: string;
  senderId: string;
  category: Category | null;
  tier: number | null;
  limit: number;
  stats: SenderStats | null;
  paused?: boolean;
  warn?: string | null;
  actions?: React.ReactNode;
}) {
  const h = HEALTH[stats?.health ?? 'not_enough_data'];
  const used = stats?.promo_today ?? 0;
  return (
    <div className={`sender-card${paused ? ' paused' : ''}`}>
      <div className="row-between">
        <div>
          <div className="strong">{name}</div>
          <code className="small">{senderId}</code>
        </div>
        <span className={`status ${paused ? 'st-draft' : h.cls}`} title={h.hint}>{paused ? 'Paused' : h.label}</span>
      </div>
      <div className="sender-meta">
        {category && <span className={`chip cat-${category}`}>{category}</span>}
        {tier !== null && <span className="chip">Tier {tier}</span>}
      </div>
      <dl className="sender-stats">
        <div><dt>Sent, 7 days</dt><dd>{fmt(stats?.sent ?? 0)}</dd></div>
        <div><dt>Delivered</dt><dd>{stats?.delivery_rate ?? '—'}{stats?.delivery_rate != null && '%'}</dd></div>
        <div><dt>Read</dt><dd>{stats?.read_rate ?? '—'}{stats?.read_rate != null && '%'}</dd></div>
        <div><dt>Not on Truecaller</dt><dd>{stats?.unreachable_rate ?? '—'}{stats?.unreachable_rate != null && '%'}</dd></div>
      </dl>
      <div className="limit">
        <div className="row-between small"><span className="muted">Promotional today</span><span>{fmt(used)} / {fmt(limit)}</span></div>
        <div className="limit-track"><div style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }} /></div>
      </div>
      <div className="hint">{stats?.last_sent_at ? `Last message ${when(stats.last_sent_at)}` : 'No messages in the last 7 days'}</div>
      {warn && <div className="hint bad">{warn}</div>}
      {actions && <div className="sender-actions">{actions}</div>}
    </div>
  );
}

const STEPS = ['Business', 'Messages', 'Review'];

function RequestWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(blankRequest);
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState<SenderRequest | null>(null);
  const { busy, error, run } = useAsync();
  const set = (k: keyof SenderRequestInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const stepOk = [
    f.display_name.trim().length >= 2 && f.legal_name.trim().length >= 2,
    f.use_case.trim().length >= 10,
    true,
  ][step];

  if (sent) {
    return (
      <Drawer title="Request sent" onClose={onDone} narrow footer={<><div className="spacer" /><button className="btn primary" onClick={onDone}>Done</button></>}>
        <div className="form pad">
          <p>Your request <code>{sent.ref}</code> for <b>{f.display_name}</b> is <span className="status rq-submitted">Pending</span> with our onboarding team.</p>
          <p className="muted">We've emailed you a copy. You'll get another email when it moves to review and when the sender is live. Track it on this page.</p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title="Request a sender"
      onClose={onClose}
      narrow
      footer={
        <>
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <div className="spacer" />
          {step < STEPS.length - 1 ? (
            <button className="btn primary" disabled={!stepOk} onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => run(() => senders.request(f).then(setSent))}>Send request</button>
          )}
        </>
      }
    >
      <div className="form pad">
        <ol className="steps">
          {STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</li>)}
        </ol>

        {step === 0 && (
          <>
            <p className="muted">Who will people see the message from? We register this profile with Truecaller.</p>
            <label>
              Display name
              <input className="input" autoFocus value={f.display_name} onChange={set('display_name')} placeholder="e.g. Your brand name" maxLength={60} />
              <span className="hint">Shown above your message, with the verified badge.</span>
            </label>
            <label>
              Registered business name
              <input className="input" value={f.legal_name} onChange={set('legal_name')} placeholder="As on your company registration" />
            </label>
            <label>
              Website <span className="hint">Optional</span>
              <input className="input" value={f.website} onChange={set('website')} placeholder="https://" />
            </label>
            <label>
              Contact email for this request <span className="hint">Optional, we always email you too</span>
              <input className="input" type="email" value={f.contact_email} onChange={set('contact_email')} placeholder="e.g. compliance@yourcompany.com" />
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <label>
              Category
              <select className="input" value={f.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
              </select>
              <span className="hint">
                {f.category === 'promotional' ? 'Offers and marketing. Starts at Tier 1 with daily limits that grow with good delivery.'
                  : f.category === 'transactional' ? 'OTPs, order, payment and account updates people expect.' : 'Reminders, alerts and service notices.'}
              </span>
            </label>
            <label>
              What will you send?
              <textarea className="input" rows={3} value={f.use_case} onChange={set('use_case')} placeholder="e.g. Order confirmations and delivery updates for online customers." />
            </label>
            <label>
              Sample message <span className="hint">Optional, helps approval</span>
              <textarea className="input" rows={3} value={f.sample_message} onChange={set('sample_message')} placeholder="Hi {{name}}, your order {{order_id}} has shipped." />
            </label>
            <label>
              Expected monthly volume <span className="hint">Optional</span>
              <input className="input" value={f.monthly_volume} onChange={set('monthly_volume')} placeholder="e.g. 200,000" />
            </label>
          </>
        )}

        {step === 2 && (
          <dl className="review">
            <dt>Display name</dt><dd>{f.display_name}</dd>
            <dt>Business name</dt><dd>{f.legal_name}</dd>
            <dt>Website</dt><dd>{f.website || '—'}</dd>
            <dt>Category</dt><dd>{cap(f.category)}</dd>
            <dt>Use</dt><dd>{f.use_case}</dd>
            <dt>Sample</dt><dd>{f.sample_message || '—'}</dd>
            <dt>Monthly volume</dt><dd>{f.monthly_volume || '—'}</dd>
            <dt>Contact</dt><dd>{f.contact_email || 'Your account email'}</dd>
          </dl>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}

function AddSender({ request, onClose, onDone }: { request: SenderRequest | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    sender_id: '',
    display_name: request?.display_name ?? '',
    category: request?.category ?? ('transactional' as Category),
    tier: 1,
    daily_limit: '',
  });
  const { busy, error, run } = useAsync();
  const save = () =>
    run(() => senders.add({
      sender_id: f.sender_id.trim(), display_name: f.display_name.trim(), category: f.category, tier: f.tier,
      daily_limit: f.daily_limit ? Number(f.daily_limit.replace(/\D/g, '')) : null, request_id: request?.id,
    }).then(onDone));
  return (
    <Drawer
      title={request ? `Create sender for ${request.ref}` : 'Add sender'}
      onClose={onClose}
      narrow
      footer={<><div className="spacer" /><button className="btn primary" disabled={busy || !f.sender_id.trim() || !f.display_name.trim()} onClick={save}>{request ? 'Create and approve' : 'Add sender'}</button></>}
    >
      <div className="form pad">
        <p className="muted">
          Add a sender only after Truecaller has verified it. It becomes available to this workspace straight away.
          {request && ' The request is marked approved and the customer is emailed.'}
        </p>
        <label>
          Truecaller sender ID
          <input className="input" autoFocus value={f.sender_id} onChange={(e) => setF({ ...f, sender_id: e.target.value })} />
        </label>
        <label>
          Display name
          <input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </label>
        <label>
          Category
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
        </label>
        <LimitFields tier={f.tier} limit={f.daily_limit} onChange={(tier, daily_limit) => setF({ ...f, tier, daily_limit })} />
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}

function EditLimits({ sender, onClose, onDone }: { sender: Sender; onClose: () => void; onDone: () => void }) {
  const [tier, setTier] = useState(sender.tier);
  const [limit, setLimit] = useState(sender.daily_limit ? String(sender.daily_limit) : '');
  const { busy, error, run } = useAsync();
  return (
    <Drawer
      title={`Tier and limit: ${sender.display_name}`}
      onClose={onClose}
      narrow
      footer={<><div className="spacer" /><button className="btn primary" disabled={busy}
        onClick={() => run(() => senders.update(sender.id, { tier, daily_limit: limit ? Number(limit.replace(/\D/g, '')) : null }).then(onDone))}>Save</button></>}
    >
      <div className="form pad">
        <LimitFields tier={tier} limit={limit} onChange={(t, l) => (setTier(t), setLimit(l))} />
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}

function LimitFields({ tier, limit, onChange }: { tier: number; limit: string; onChange: (tier: number, limit: string) => void }) {
  return (
    <>
      <label>
        Truecaller tier
        <select className="input" value={tier} onChange={(e) => onChange(Number(e.target.value), limit)}>
          {[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <span className="hint">From the Truecaller partner portal. Truecaller's API doesn't report it, so keep it in sync here.</span>
      </label>
      <label>
        Daily promotional limit <span className="hint">Optional</span>
        <input className="input" inputMode="numeric" value={limit} onChange={(e) => onChange(tier, e.target.value)} placeholder="Platform default" />
        <span className="hint">Campaigns pause for the day when this sender reaches it.</span>
      </label>
    </>
  );
}
