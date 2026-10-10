import { useEffect, useState } from 'react';
import { campaigns, downloadCsv, type Campaign, type Report } from './api';
import { Funnel, PageHead, fmt, usePoll, when } from './ui';

export function ReportsPage({ id, onSelect }: { id: string | null; onSelect: (id: string) => void }) {
  const [all, setAll] = useState<Campaign[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePoll(() => void campaigns.all().then(setAll, (e) => setError(e.message)), 0, false);

  const launched = (all ?? []).filter((c) => c.processed > 0 || c.status === 'running');
  const current = id ?? launched[0]?.id ?? null;
  const live = report?.campaign.status === 'running';
  const fetchReport = () => void (current && campaigns.report(current).then(setReport, (e) => setError(e.message)));
  useEffect(fetchReport, [current]);
  usePoll(fetchReport, 3000, live);

  return (
    <>
      <PageHead
        title="Reports"
        sub="Per-campaign funnel from recipients to read, with reasons for every failed or skipped contact."
        action={
          launched.length > 0 && (
            <select className="input select-inline" value={current ?? ''} onChange={(e) => onSelect(e.target.value)}>
              {launched.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )
        }
      />
      {error && <div className="banner error">{error}</div>}
      {!all ? (
        <div className="card"><p className="empty">Loading…</p></div>
      ) : launched.length === 0 ? (
        <div className="card"><div className="empty"><p>Reports show up once a campaign has started sending.</p><a className="btn" href="#/campaigns">Go to campaigns</a></div></div>
      ) : !report ? (
        <div className="card"><p className="empty">Loading report…</p></div>
      ) : (
        <>
          <div className="report-head">
            <div>
              <h2>{report.campaign.name} <span className={`status cs-${report.campaign.status}`}>{report.campaign.status}</span></h2>
              <p className="muted small">
                {report.campaign.template_name} → {report.campaign.list_name} · sender {report.campaign.sender_id} · started {when(report.campaign.started_at)}
                {report.campaign.completed_at && ` · finished ${when(report.campaign.completed_at)}`}
              </p>
            </div>
            <button className="btn" onClick={() => downloadCsv(`/v1/campaigns/${report.campaign.id}/messages.csv`, `${report.campaign.name}.csv`).catch((e) => setError(e.message))}>
              Export CSV
            </button>
          </div>

          <div className="tiles">
            <Tile label="Delivery rate" value={`${report.rates.delivery_rate}%`} sub="of sent" />
            <Tile label="Read rate" value={`${report.rates.read_rate}%`} sub="of delivered" />
            <Tile label="Failed" value={fmt(report.campaign.failed)} sub={`${report.rates.failure_rate}% of processed`} bad={report.campaign.failed > 0} />
            <Tile label="Skipped" value={fmt(report.campaign.blocked)} sub="limits and opt-outs" />
          </div>

          <div className="grid-2">
            <section className="card pad">
              <h3>Funnel</h3>
              <Funnel steps={report.funnel} />
            </section>
            <section className="card pad">
              <h3>Why contacts didn't get it</h3>
              {report.reasons.length === 0 ? (
                <p className="muted">Nothing failed or skipped.</p>
              ) : (
                <table className="table compact">
                  <tbody>
                    {report.reasons.map((r) => (
                      <tr key={r.status + r.reason} className="static">
                        <td><span className={`status ${r.status === 'failed' ? 'st-rejected' : 'st-submitted'}`}>{r.status === 'failed' ? 'failed' : 'skipped'}</span></td>
                        <td>{r.reason}</td>
                        <td className="num">{fmt(r.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {report.timeline.length > 1 && (
            <section className="card pad">
              <h3>Sending over time</h3>
              <div className="spark">
                {(() => {
                  const max = Math.max(...report.timeline.map((t) => t.processed));
                  return report.timeline.map((t) => (
                    <div key={t.minute} title={`${new Date(t.minute).toLocaleTimeString()}: ${fmt(t.processed)}`} style={{ height: `${(t.processed / max) * 100}%` }} />
                  ));
                })()}
              </div>
              <p className="hint">Contacts processed per minute</p>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Tile({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="tile">
      <span className="muted small">{label}</span>
      <b className={bad ? 'bad' : ''}>{value}</b>
      <span className="hint">{sub}</span>
    </div>
  );
}
