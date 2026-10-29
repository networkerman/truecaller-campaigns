import { useState } from 'react';
import { senders, type Category, type SenderRequest, type SenderRequestInput, type SendersResponse } from './api';
import { Drawer, PageHead, useAsync, usePoll, when } from './ui';

const CATEGORIES: Category[] = ['transactional', 'service', 'promotional'];
const REQUEST_STATUS: SenderRequest['status'][] = ['submitted', 'in_review', 'approved', 'rejected'];
const label = (s: string) => (s[0].toUpperCase() + s.slice(1)).replace('_', ' ');
const blankRequest: SenderRequestInput = { display_name: '', legal_name: '', category: 'transactional', website: '', use_case: '', monthly_volume: '' };

// A sender is the verified business profile people see in Truecaller. OneXtel registers each one
// with Truecaller by hand, so customers request them here and a OneXtel admin adds them when live.
export function SendersPage({ canRequest }: { canRequest: boolean }) {
  const [data, setData] = useState<SendersResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { busy, error, run } = useAsync();
  const load = () => run(() => senders.all().then(setData));
  usePoll(load, 0, false);

  const toggle = (id: string, status: 'active' | 'paused') => run(() => senders.setStatus(id, status).then(load));
  const setRequestStatus = (r: SenderRequest, status: SenderRequest['status']) => {
    const note = status === 'rejected' || status === 'approved' ? prompt('Note for the customer (optional)', r.note ?? '') : undefined;
    if (note === null) return;
    run(() => senders.setRequestStatus(r.id, status, note || undefined).then(load));
  };
  const contact = data?.contact;

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
          {contact.email && <> at <a href={`mailto:${contact.email}`}>{contact.email}</a></>}. Send them a request here
          and they will confirm the details with you. Verification usually takes a few working days.
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Active senders</h3>
          {data?.can_manage && <button className="btn small" onClick={() => setAdding(true)}>Add sender</button>}
        </div>
        {!data ? (
          <p className="empty">Loading senders…</p>
        ) : data.data.length === 0 ? (
          <p className="empty">
            No senders registered for this workspace yet. Campaigns go out from the platform default, <code>{data.default_sender}</code>.
          </p>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Sender ID</th><th>Category</th><th>Added</th><th>Status</th>{data.can_manage && <th />}</tr></thead>
            <tbody>
              {data.data.map((s) => (
                <tr key={s.id} className="static">
                  <td className="strong">{s.display_name}</td>
                  <td>
                    <code>{s.sender_id}</code>
                    {s.has_credential === false && <div className="hint bad">No Truecaller key on the server yet</div>}
                  </td>
                  <td><span className={`chip cat-${s.category}`}>{s.category}</span></td>
                  <td className="muted">{when(s.created_at)}</td>
                  <td><span className={`status ${s.status === 'active' ? 'st-approved' : 'st-draft'}`}>{s.status}</span></td>
                  {data.can_manage && (
                    <td className="num">
                      <button className="btn small" disabled={busy} onClick={() => toggle(s.id, s.status === 'active' ? 'paused' : 'active')}>
                        {s.status === 'active' ? 'Pause' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.requests.length > 0 && (
        <div className="card section">
          <div className="card-head"><h3>Requests</h3></div>
          <table className="table">
            <thead><tr><th>Name</th><th>Category</th><th>Requested</th><th>Status</th></tr></thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id} className="static">
                  <td>
                    <div className="strong">{r.display_name}</div>
                    <div className="muted small">{r.legal_name}{r.website && ` · ${r.website}`}</div>
                    <div className="small clip" title={r.use_case}>{r.use_case}</div>
                  </td>
                  <td><span className={`chip cat-${r.category}`}>{r.category}</span></td>
                  <td className="muted small">{when(r.created_at)}{r.requested_by && <div>by {r.requested_by}</div>}</td>
                  <td>
                    {data.can_manage ? (
                      <select className="input role-select" value={r.status} disabled={busy} onChange={(e) => setRequestStatus(r, e.target.value as SenderRequest['status'])}>
                        {REQUEST_STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                      </select>
                    ) : (
                      <span className={`status rq-${r.status}`}>{label(r.status)}</span>
                    )}
                    {r.note && <div className="muted small">{r.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requesting && <RequestForm onClose={() => setRequesting(false)} onDone={() => (setRequesting(false), load())} />}
      {adding && <AddSender onClose={() => setAdding(false)} onDone={() => (setAdding(false), load())} />}
    </>
  );
}

function RequestForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(blankRequest);
  const { busy, error, run } = useAsync();
  const set = (k: keyof SenderRequestInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = f.display_name.trim() && f.legal_name.trim() && f.use_case.trim().length >= 10;

  return (
    <Drawer
      title="Request a sender"
      onClose={onClose}
      narrow
      footer={<><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !ready} onClick={() => run(() => senders.request(f).then(onDone))}>Send request</button></>}
    >
      <div className="form pad">
        <p className="muted">Tell us who will be sending. We check the details and register the profile with Truecaller.</p>
        <label>
          Display name
          <input className="input" autoFocus value={f.display_name} onChange={set('display_name')} placeholder="e.g. Acme Bank" maxLength={60} />
          <span className="hint">What people see above your message.</span>
        </label>
        <label>
          Registered business name
          <input className="input" value={f.legal_name} onChange={set('legal_name')} placeholder="e.g. Acme Bank Limited" />
        </label>
        <label>
          Category
          <select className="input" value={f.category} onChange={set('category')}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </label>
        <label>
          Website <span className="hint">Optional</span>
          <input className="input" value={f.website} onChange={set('website')} placeholder="https://" />
        </label>
        <label>
          What will you send?
          <textarea className="input" rows={3} value={f.use_case} onChange={set('use_case')} placeholder="e.g. Order updates and delivery alerts for online customers." />
        </label>
        <label>
          Expected monthly volume <span className="hint">Optional</span>
          <input className="input" value={f.monthly_volume} onChange={set('monthly_volume')} placeholder="e.g. 200,000" />
        </label>
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}

function AddSender({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ sender_id: '', display_name: '', category: 'transactional' as Category });
  const { busy, error, run } = useAsync();
  return (
    <Drawer
      title="Add sender"
      onClose={onClose}
      narrow
      footer={<><div className="spacer" /><button className="btn primary" disabled={busy || !f.sender_id.trim() || !f.display_name.trim()} onClick={() => run(() => senders.add(f).then(onDone))}>Add sender</button></>}
    >
      <div className="form pad">
        <p className="muted">Add a sender only after Truecaller has verified it. It becomes available to this workspace straight away.</p>
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
            {CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </label>
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}
