import { useRef, useState } from 'react';
import { api, campaigns, lists, senders, type Campaign, type ContactList, type SendersResponse, type Template } from './api';
import { CampaignWizard } from './CampaignWizard';
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
      {open === 'new' && <CampaignWizard onClose={() => setOpen(null)} onCreated={(id) => (load(), setOpen(id))} />}
      {open && open !== 'new' && <CampaignDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
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
