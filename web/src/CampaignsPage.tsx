import { useRef, useState } from 'react';
import { api, campaigns, lists, senders, type Campaign, type ContactList, type SendersResponse, type Template } from './api';
import { AudiencePicker, audienceSource, emptyAudience, type Audience } from './Audience';
import { Drawer, Funnel, PageHead, RichParts, fmt, useAsync, usePoll, when } from './ui';

const LIVE = ['running', 'scheduled'];
const VARS = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function CampaignsPage() {
  const [data, setData] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const load = () => campaigns.all().then((d) => (setData(d), setError(null)), (e) => setError(e.message));
  const live = !!data?.some((c) => LIVE.includes(c.status));
  usePoll(load, 3000, live);

  return (
    <>
      <PageHead
        title="Campaigns"
        sub="Send an approved template to a contact list, now or at a scheduled time. Truecaller promo limits are applied per contact."
        action={<button className="btn primary" onClick={() => setOpen('new')}>New campaign</button>}
      />
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        {!data ? (
          <p className="empty">Loading campaigns…</p>
        ) : data.length === 0 ? (
          <div className="empty">
            <p>No campaigns yet.</p>
            <button className="btn" onClick={() => setOpen('new')}>Create your first campaign</button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Campaign</th><th>Status</th><th>Progress</th><th>Delivered</th><th>Read</th><th>When</th></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c.id)}>
                  <td>
                    <div className="strong">{c.name}</div>
                    <div className="muted small">{c.template_name} → {c.list_name}</div>
                  </td>
                  <td><span className={`status cs-${c.status}`}>{c.status}</span></td>
                  <td className="progress-cell">
                    <div className="progress"><div style={{ width: `${c.recipients ? (c.processed / c.recipients) * 100 : 0}%` }} /></div>
                    <span className="muted small">{fmt(c.processed)} / {fmt(c.recipients)}</span>
                  </td>
                  <td>{fmt(c.delivered)}</td>
                  <td>{fmt(c.read)}</td>
                  <td className="muted small">
                    {c.status === 'scheduled' ? `Starts ${when(c.scheduled_at)}` : c.started_at ? when(c.started_at) : 'Not launched'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open === 'new' && <NewCampaign onClose={() => setOpen(null)} onCreated={(id) => (load(), setOpen(id))} />}
      {open && open !== 'new' && <CampaignDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function NewCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allLists, setLists] = useState<ContactList[]>([]);
  const [senderInfo, setSenderInfo] = useState<SendersResponse | null>(null);
  const [form, setForm] = useState({ name: '', template_id: '', sender_id: '', when: 'now', at: '' });
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [trackClicks, setTrackClicks] = useState(true);
  const [audience, setAudience] = useState<Audience>(emptyAudience);
  // Keeps the list made from an upload, so a retry after an error doesn't import it twice.
  const imported = useRef<{ from: Audience; listId: string } | null>(null);
  const { busy, error, run, setError } = useAsync();
  usePoll(() => {
    api.listTemplates().then(setTemplates);
    lists.all().then(setLists);
    senders.all().then(setSenderInfo, () => {});
  }, 0, false);
  const activeSenders = senderInfo?.data.filter((x) => x.status === 'active') ?? [];

  const t = templates.find((x) => x.id === form.template_id);
  const cohort = audience.mode === 'cohort' ? allLists.find((x) => x.id === audience.listId) : undefined;
  const recipients = cohort ? cohort.contact_count : audience.check?.valid ?? 0;
  // Campaign defaults start from the template's and can be changed for this send only.
  const pickTemplate = (id: string) => {
    setForm({ ...form, template_id: id });
    setDefaults({ ...(templates.find((x) => x.id === id)?.variable_defaults ?? {}) });
  };
  const sample = audience.check?.preview?.[0]?.attributes ?? {};
  const hasLink = !!t && (/https?:\/\//.test(t.body) || (t.buttons ?? []).some((b) => b.type === 'link'));
  const ready = form.name.trim() && t && (cohort || recipients > 0) && (form.when === 'now' || form.at);

  // A cohort is used as is. Any other source becomes a new contact list named after the campaign.
  const resolveList = async () => {
    if (cohort) return cohort.id;
    if (imported.current?.from === audience) return imported.current.listId;
    const list = await lists.create(`${form.name.trim()} · ${new Date().toLocaleString('en-IN')}`);
    await lists.importFrom(list.id, audienceSource(audience)!);
    imported.current = { from: audience, listId: list.id };
    return list.id;
  };

  const create = (launch: boolean) =>
    run(async () => {
      if (launch && form.when === 'later' && new Date(form.at).getTime() <= Date.now()) return setError('Pick a time in the future');
      if (launch && !confirm(form.when === 'now' ? `Send to ${fmt(recipients)} contacts now?` : `Schedule for ${new Date(form.at).toLocaleString()}?`)) return;
      const list_id = await resolveList();
      const c = await campaigns.create({
        name: form.name.trim(), template_id: form.template_id, list_id, sender_id: form.sender_id.trim() || undefined,
        variable_defaults: defaults, track_links: hasLink ? trackClicks : undefined,
      });
      if (launch) await campaigns.launch(c.id, form.when === 'later' ? new Date(form.at).toISOString() : undefined);
      onCreated(c.id);
    });

  return (
    <Drawer
      title="New campaign"
      onClose={onClose}
      narrow
      footer={
        <>
          <div className="spacer" />
          <button className="btn" disabled={busy || !ready} onClick={() => create(false)}>Save as draft</button>
          <button className="btn primary" disabled={busy || !ready || t?.status !== 'approved'} onClick={() => create(true)}>
            {form.when === 'now' ? 'Send now' : 'Schedule'}
          </button>
        </>
      }
    >
      <div className="form pad">
        <label>
          Campaign name
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali sale, Pune" />
        </label>
        <label>
          Template
          <select className="input" value={form.template_id} onChange={(e) => pickTemplate(e.target.value)}>
            <option value="">Choose a template</option>
            {templates.map((x) => (
              <option key={x.id} value={x.id} disabled={x.status !== 'approved'}>
                {x.name} ({x.category}{x.status !== 'approved' ? `, ${x.status}` : ''})
              </option>
            ))}
          </select>
          {templates.length > 0 && !templates.some((x) => x.status === 'approved') && <span className="hint bad">No approved templates yet. Submit one on the Templates page.</span>}
        </label>
        <AudiencePicker value={audience} onChange={setAudience} cohorts={allLists} variables={(t?.variables ?? []).filter((v) => !defaults[v]?.trim())} />
        <label>
          Sender
          {activeSenders.length ? (
            <select className="input" value={form.sender_id || activeSenders[0].sender_id} onChange={(e) => setForm({ ...form, sender_id: e.target.value })}>
              {activeSenders.map((x) => (
                <option key={x.id} value={x.sender_id}>{x.display_name} ({x.sender_id})</option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={senderInfo ? `${senderInfo.default_sender} (platform default)` : ''} />
          )}
          <span className="hint">Need a different sender? <a className="link" href="#/senders">Request one</a>.</span>
        </label>
        <fieldset className="choice">
          <label className="inline"><input type="radio" checked={form.when === 'now'} onChange={() => setForm({ ...form, when: 'now' })} /> Send now</label>
          <label className="inline"><input type="radio" checked={form.when === 'later'} onChange={() => setForm({ ...form, when: 'later' })} /> Schedule</label>
          {form.when === 'later' && <input className="input" type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />}
        </fieldset>

        {t && t.variables.length > 0 && (
          <fieldset className="samples">
            <legend>Personalisation</legend>
            <p className="hint">Each {'{{variable}}'} is filled from the list column of the same name. The default is used when a contact's cell is empty.</p>
            {t.variables.map((v) => (
              <label key={v} className="inline">
                <code>{v}</code>
                <input className="input" value={defaults[v] ?? ''} placeholder="Default, e.g. Customer"
                  onChange={(e) => setDefaults({ ...defaults, [v]: e.target.value })} />
              </label>
            ))}
          </fieldset>
        )}
        {hasLink && (
          <label className="inline">
            <input type="checkbox" checked={trackClicks} onChange={(e) => setTrackClicks(e.target.checked)} />
            Track link clicks (links go through a short redirect so clicks show in reports)
          </label>
        )}
        {t && (
          <div className="bubble preview-bubble">
            {t.body.replace(VARS, (_, v: string) => (String(sample[v] ?? '').trim() || defaults[v]?.trim() || `[${v}]`))}
            <RichParts media={t.media} buttons={t.buttons}
              fill={(x) => x.replace(VARS, (_, v: string) => String(sample[v] ?? '').trim() || defaults[v]?.trim() || `[${v}]`)} />
          </div>
        )}
        {t?.category === 'promotional' && (
          <p className="hint">Promotional: contacts already sent 3 promo messages today, or 4 from this sender in 28 days, are skipped. Opted-out numbers are always skipped.</p>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
    </Drawer>
  );
}

function CampaignDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<Campaign | null>(null);
  const { busy, error, run } = useAsync();
  usePoll(() => void campaigns.get(id).then(setC), 2000, !c || LIVE.includes(c.status));

  const act = (fn: () => Promise<unknown>) => run(async () => (await fn(), setC(await campaigns.get(id)), onChanged()));

  return (
    <Drawer
      title={c?.name ?? 'Campaign'}
      badge={c && <span className={`status cs-${c.status}`}>{c.status}</span>}
      onClose={onClose}
      narrow
      footer={
        c && (
          <>
            {c.status === 'draft' && <button className="btn danger-ghost" disabled={busy} onClick={() => confirm('Delete this draft?') && run(() => campaigns.remove(id).then(() => (onChanged(), onClose())))}>Delete</button>}
            {LIVE.includes(c.status) && <button className="btn danger-ghost" disabled={busy} onClick={() => confirm('Stop this campaign? Messages already sent stay sent.') && act(() => campaigns.cancel(id))}>Cancel campaign</button>}
            <div className="spacer" />
            {c.processed > 0 && <a className="btn" href={`#/reports/${id}`} onClick={onClose}>Full report</a>}
            {c.status === 'draft' && <button className="btn primary" disabled={busy || c.template_status !== 'approved'} onClick={() => confirm(`Send to ${fmt(c.recipients)} contacts now?`) && act(() => campaigns.launch(id))}>Send now</button>}
          </>
        )
      }
    >
      {!c ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className="form pad">
          {c.note && <div className="banner warn">{c.note}</div>}
          {error && <div className="banner error">{error}</div>}
          <dl className="facts">
            <dt>Template</dt><dd>{c.template_name} <span className={`chip cat-${c.category}`}>{c.category}</span></dd>
            <dt>List</dt><dd>{c.list_name} ({fmt(c.recipients)} contacts)</dd>
            <dt>Sender</dt><dd>{c.sender_id}</dd>
            {c.scheduled_at && <><dt>Scheduled</dt><dd>{when(c.scheduled_at)}</dd></>}
            <dt>Started</dt><dd>{when(c.started_at)}</dd>
            {c.completed_at && <><dt>Finished</dt><dd>{when(c.completed_at)}</dd></>}
          </dl>
          <div className="progress big"><div style={{ width: `${c.recipients ? (c.processed / c.recipients) * 100 : 0}%` }} /></div>
          <p className="hint">{fmt(c.processed)} of {fmt(c.recipients)} contacts processed</p>
          <section className="drawer-section">
            <Funnel steps={[
              { stage: 'Recipients', count: c.recipients }, { stage: 'Sent', count: c.sent },
              { stage: 'Delivered', count: c.delivered }, { stage: 'Read', count: c.read },
              { stage: 'Failed', count: c.failed, bad: true }, { stage: 'Skipped', count: c.blocked, bad: true },
            ]} />
          </section>
          <div className="stat-row">
            <div className="stat"><span>Failed</span><b className="bad">{fmt(c.failed)}</b></div>
            <div className="stat"><span>Skipped by limits / opt-out</span><b>{fmt(c.blocked)}</b></div>
          </div>
          <div className="bubble preview-bubble">{c.template_body}<RichParts media={c.template_media} buttons={c.template_buttons} /></div>
        </div>
      )}
    </Drawer>
  );
}
