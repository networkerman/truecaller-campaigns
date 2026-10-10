import { useEffect, useMemo, useState } from 'react';
import { api, type Campaign, type CampaignInput, type ContactList, type Template } from './api';
import { Drawer } from './Drawer';

const ACTIVE: Campaign['status'][] = ['scheduled', 'running', 'paused'];
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export const done = (c: Campaign) => c.stats.sent + c.stats.failed + c.stats.blocked;

export function Progress({ c }: { c: Campaign }) {
  if (c.status === 'draft' || c.status === 'scheduled') return <span className="muted">{c.list_size.toLocaleString()} contacts</span>;
  const pct = c.total ? Math.round((done(c) / c.total) * 100) : 0;
  return (
    <div className="progress" title={`${done(c)} of ${c.total} processed`}>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="muted">
        {done(c).toLocaleString()} / {c.total.toLocaleString()}
      </span>
    </div>
  );
}

const when = (c: Campaign) =>
  c.status === 'scheduled' && c.scheduled_at
    ? `Starts ${new Date(c.scheduled_at).toLocaleString()}`
    : c.started_at
      ? `Started ${new Date(c.started_at).toLocaleString()}`
      : `Created ${new Date(c.created_at).toLocaleString()}`;

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | 'new' | null>(null);

  const load = () =>
    api
      .listCampaigns()
      .then((c) => (setCampaigns(c), setError(null)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => void load(), []);

  // Keep progress live while anything is sending or waiting to start.
  const live = campaigns.some((c) => ACTIVE.includes(c.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [live]);

  const current = open && open !== 'new' ? campaigns.find((c) => c.id === open) ?? null : null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p className="muted">Send an approved template to a contact list, now or at a set time.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen('new')}>
          New campaign
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="empty">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <div className="empty">
            <p>No campaigns yet. You need an approved template and a contact list.</p>
            <button className="btn" onClick={() => setOpen('new')}>
              Create a campaign
            </button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Template · List</th>
                <th>Status</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c.id)}>
                  <td>
                    <div className="strong">{c.name}</div>
                    <div className="muted small">{when(c)}</div>
                  </td>
                  <td className="muted">
                    {c.template_name} · {c.list_name}
                  </td>
                  <td>
                    <span className={`status cs-${c.status}`}>{c.status}</span>
                  </td>
                  <td>
                    <Progress c={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(open === 'new' || current) && (
        <CampaignDrawer
          campaign={current}
          onClose={() => setOpen(null)}
          onChanged={(c) => {
            void load();
            setOpen(c ? c.id : null);
          }}
        />
      )}
    </>
  );
}

function CampaignDrawer({
  campaign,
  onClose,
  onChanged,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onChanged: (c: Campaign | null) => void;
}) {
  const editable = !campaign || campaign.status === 'draft';
  const [form, setForm] = useState<CampaignInput>(
    campaign
      ? { name: campaign.name, template_id: campaign.template_id, list_id: campaign.list_id, sender_id: campaign.sender_id }
      : { name: '', template_id: '', list_id: '', sender_id: '' },
  );
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [sample, setSample] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editable) return;
    api.listTemplates().then((t) => setTemplates(t.filter((x) => x.status === 'approved'))).catch((e) => setError(e.message));
    api.listLists().then(setLists).catch((e) => setError(e.message));
  }, [editable]);

  useEffect(() => {
    if (!form.list_id) return setSample(null);
    api
      .listContacts(form.list_id, 1)
      .then((c) => setSample(c[0]?.attrs ?? null))
      .catch(() => setSample(null));
  }, [form.list_id]);

  const template = templates.find((t) => t.id === form.template_id);
  const list = lists.find((l) => l.id === form.list_id);
  const missing = useMemo(
    () => (template && list ? template.variables.filter((v) => !list.columns.includes(v)) : []),
    [template, list],
  );
  const preview = template ? template.body.replace(PLACEHOLDER, (_, v: string) => sample?.[v] || `{{${v}}}`) : '';
  const dirty =
    !campaign ||
    form.name !== campaign.name ||
    form.template_id !== campaign.template_id ||
    form.list_id !== campaign.list_id ||
    (form.sender_id ?? '') !== campaign.sender_id;
  const valid = form.name.trim() && template && list && missing.length === 0;

  const run = async (fn: () => Promise<Campaign | null | void>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      const c = await fn();
      onChanged(close ? null : (c ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => (campaign ? api.updateCampaign(campaign.id, form) : api.createCampaign(form));
  const launch = () =>
    run(async () => {
      const c = dirty ? await save() : campaign!;
      if (when === 'later' && !at) throw new Error('Pick a date and time');
      return api.launchCampaign(c.id, when === 'later' ? new Date(at).toISOString() : undefined);
    });

  const minAt = new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  if (!editable && campaign) return <CampaignStatusView campaign={campaign} onClose={onClose} run={run} busy={busy} error={error} />;

  return (
    <Drawer
      title={campaign ? 'Edit campaign' : 'New campaign'}
      badge={campaign && <span className="status cs-draft">draft</span>}
      onClose={onClose}
      wide
      footer={
        <>
          {campaign && (
            <button className="btn danger-ghost" disabled={busy}
              onClick={() => confirm(`Delete draft "${campaign.name}"?`) && run(() => api.deleteCampaign(campaign.id), true)}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={() => run(save)} disabled={busy || !valid || !dirty}>
            Save draft
          </button>
          <button className="btn primary" onClick={launch} disabled={busy || !valid || !list?.contact_count}>
            {when === 'now' ? `Send to ${list?.contact_count.toLocaleString() ?? 0} contacts` : 'Schedule'}
          </button>
        </>
      }
    >
      <div className="split">
        <div className="form">
          <label>
            Name
            <input className="input" value={form.name} maxLength={100} placeholder="e.g. Diwali offer, north region"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>

          <label>
            Template
            <select className="input" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
              <option value="">Choose an approved template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category})
                </option>
              ))}
            </select>
            {templates.length === 0 && <span className="hint">No approved templates yet. Submit one on the Templates page.</span>}
            {template?.category === 'promotional' && (
              <span className="hint">Promotional: Truecaller allows 4 sends per user every 28 days.</span>
            )}
          </label>

          <label>
            Contact list
            <select className="input" value={form.list_id} onChange={(e) => setForm({ ...form, list_id: e.target.value })}>
              <option value="">Choose a list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.contact_count.toLocaleString()})
                </option>
              ))}
            </select>
            {list && list.contact_count === 0 && <span className="hint bad">This list is empty.</span>}
          </label>

          {missing.length > 0 && (
            <div className="banner error">
              The list has no column for {missing.map((m) => `{{${m}}}`).join(', ')}. Add the column to the CSV and re-import, or
              pick another list.
            </div>
          )}
          {template && list && missing.length === 0 && template.variables.length > 0 && (
            <p className="hint">Contacts with an empty value for a variable are skipped and counted as failed.</p>
          )}

          <label>
            Sender ID <span className="hint">Optional. Leave blank for the default.</span>
            <input className="input" value={form.sender_id ?? ''} maxLength={50}
              onChange={(e) => setForm({ ...form, sender_id: e.target.value })} />
          </label>

          <fieldset className="choice">
            <legend>When</legend>
            <label className="inline">
              <input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Send now
            </label>
            <label className="inline">
              <input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> Schedule for later
            </label>
            {when === 'later' && (
              <input className="input" type="datetime-local" min={minAt} value={at} onChange={(e) => setAt(e.target.value)} />
            )}
          </fieldset>

          {error && <div className="banner error">{error}</div>}
        </div>

        <div className="preview">
          <div className="phone">
            <div className="phone-head">
              <span className="avatar">B</span>
              <div>
                <div className="strong">Your Brand</div>
                <div className="verified">Verified business</div>
              </div>
            </div>
            <div className="bubble">{preview || <span className="muted">Choose a template to preview</span>}</div>
            {sample && template && template.variables.length > 0 && <p className="hint center">Filled with the first contact</p>}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function CampaignStatusView({
  campaign: c,
  onClose,
  run,
  busy,
  error,
}: {
  campaign: Campaign;
  onClose: () => void;
  run: (fn: () => Promise<Campaign | null | void>) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const act = (a: 'pause' | 'resume' | 'cancel' | 'unschedule') => run(() => api.campaignAction(c.id, a));
  const s = c.stats;
  const tiles = [
    { label: 'Waiting', value: s.queued },
    { label: 'Sent', value: s.sent },
    { label: 'Delivered', value: s.delivered },
    { label: 'Read', value: s.read },
    { label: 'Failed', value: s.failed + s.blocked },
  ];

  return (
    <Drawer
      title={c.name}
      badge={<span className={`status cs-${c.status}`}>{c.status}</span>}
      onClose={onClose}
      footer={
        <>
          {ACTIVE.includes(c.status) && (
            <button className="btn danger-ghost" disabled={busy}
              onClick={() => confirm('Cancel this campaign? Messages not yet sent will be dropped.') && act('cancel')}>
              Cancel campaign
            </button>
          )}
          <div className="spacer" />
          {c.status === 'scheduled' && (
            <button className="btn" disabled={busy} onClick={() => act('unschedule')}>
              Unschedule
            </button>
          )}
          {c.status === 'running' && (
            <button className="btn" disabled={busy} onClick={() => act('pause')}>
              Pause
            </button>
          )}
          {c.status === 'paused' && (
            <button className="btn primary" disabled={busy} onClick={() => act('resume')}>
              Resume
            </button>
          )}
        </>
      }
    >
      <div className="form single">
        <div className="facts">
          <div>
            <span className="muted">Template</span>
            <strong>{c.template_name}</strong>
          </div>
          <div>
            <span className="muted">List</span>
            <strong>{c.list_name}</strong>
          </div>
          <div>
            <span className="muted">Sender ID</span>
            <strong>{c.sender_id}</strong>
          </div>
          <div>
            <span className="muted">{c.status === 'scheduled' ? 'Starts' : 'Started'}</span>
            <strong>
              {c.status === 'scheduled' && c.scheduled_at
                ? new Date(c.scheduled_at).toLocaleString()
                : c.started_at
                  ? new Date(c.started_at).toLocaleString()
                  : '—'}
            </strong>
          </div>
        </div>

        {c.status === 'scheduled' ? (
          <p className="muted">Will send to {c.list_size.toLocaleString()} contacts. The list is read when the campaign starts.</p>
        ) : (
          <>
            <Progress c={c} />
            <div className="tiles">
              {tiles.map((t) => (
                <div key={t.label} className="tile">
                  <span className="muted">{t.label}</span>
                  <strong>{t.value.toLocaleString()}</strong>
                </div>
              ))}
            </div>
            {c.status === 'cancelled' && c.total > done(c) + s.queued && (
              <p className="hint">{(c.total - done(c) - s.queued).toLocaleString()} messages were not sent because the campaign was cancelled.</p>
            )}
            <p className="hint">
              Full delivery and read rates are on the <a href="#/reports">Reports</a> page.
            </p>
          </>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}
