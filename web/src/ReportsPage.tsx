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
        <div className="report-body">
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
            {report.rates.click_rate !== null && (
              <Tile label="Click rate" value={`${report.rates.click_rate}%`} sub={`${fmt(report.clicks.unique)} people, ${fmt(report.clicks.total)} clicks`} />
            )}
            <Tile label="Failed" value={fmt(report.campaign.failed)} sub={`${report.rates.failure_rate}% of processed`} bad={report.campaign.failed > 0} />
            <Tile label="Skipped" value={fmt(report.campaign.blocked)} sub="limits and opt-outs" />
            {report.campaign.expired > 0 && <Tile label="Expired" value={fmt(report.campaign.expired)} sub="no delivery report in time" bad />}
          </div>

          <section className="card pad">
            <h3>Speed</h3>
            <div className="tiles inner">
              <Tile label="Avg time to deliver" value={dur(report.timing.avg_deliver_s)} sub={`median ${dur(report.timing.median_deliver_s)}`} />
              <Tile label="Avg time to read" value={dur(report.timing.avg_read_s)} sub={`median ${dur(report.timing.median_read_s)}`} />
              <Tile label="Avg time to click" value={report.clicks.tracked ? dur(report.timing.avg_click_s) : 'No links'}
                sub={report.clicks.tracked ? `median ${dur(report.timing.median_click_s)}` : 'add a link to the template to track clicks'} />
            </div>
            <p className="hint">Measured from when Truecaller accepted each message. The median is less skewed by people who open it days later.</p>
          </section>

          <div className="grid-2">
            <section className="card pad">
              <h3>Funnel</h3>
              <Funnel steps={report.funnel} />
            </section>
            <section className="card pad">
              <h3>Why contacts didn't get it</h3>
              {report.categories.length === 0 ? (
                <p className="muted">Nothing failed or skipped.</p>
              ) : (
                <div className="reasons">
                  {report.categories.map((g) => (
                    <details key={g.key} className="reason-group">
                      <summary>
                        <span className="strong">{g.label}</span>
                        <span className="num">{fmt(g.count)} <small className="muted">{pctOf(g.count, report.campaign.processed)}</small></span>
                      </summary>
                      <p className="hint">{g.hint}</p>
                      <table className="table compact">
                        <tbody>
                          {g.reasons.map((r) => (
                            <tr key={r.status + r.reason} className="static">
                              <td><span className={`status ${r.status === 'blocked' ? 'st-submitted' : 'st-rejected'}`}>{r.status === 'blocked' ? 'skipped' : r.status}</span></td>
                              <td className="small">{r.reason}</td>
                              <td className="num">{fmt(r.count)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ))}
                </div>
              )}
            </section>
          </div>

          {report.fallback.configured.length > 0 && (
            <section className="card pad">
              <h3>Truecaller and fallback</h3>
              <p className="muted small">
                Truecaller tried {fmt(report.campaign.processed - report.campaign.blocked)}: {fmt(report.campaign.delivered)} delivered, {fmt(report.campaign.failed)} failed, {fmt(report.campaign.expired)} expired.
                {' '}Fallback went to {fmt(report.fallback.messages)} people and reached {fmt(report.fallback.reached)}.
              </p>
              <table className="table compact">
                <thead><tr><th>Fallback channel</th><th className="num">Attempted</th><th className="num">Sent to OnexAura</th><th className="num">Delivered</th><th className="num">Failed</th><th className="num">Waiting</th></tr></thead>
                <tbody>
                  {report.fallback.configured.map((ch) => {
                    const r = report.fallback.by_channel.find((x) => x.channel === ch);
                    return (
                      <tr key={ch} className="static">
                        <td className="strong">{({ rcs: 'RCS', whatsapp: 'WhatsApp', sms: 'SMS' } as const)[ch]}</td>
                        <td className="num">{fmt(r?.attempted ?? 0)}</td><td className="num">{fmt(r?.submitted ?? 0)}</td>
                        <td className="num">{fmt(r?.delivered ?? 0)}</td><td className="num">{fmt(r?.failed ?? 0)}</td><td className="num">{fmt(r?.pending ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint">Delivered counts need OnexAura delivery reports; set the callback URL from Settings in your OnexAura account.</p>
            </section>
          )}

          {report.incoming.total > 0 && (
            <section className="card pad">
              <h3>Replies</h3>
              <p className="muted small">{fmt(report.incoming.total)} replies, {fmt(report.incoming.quick_replies)} of them quick-reply taps.</p>
              <table className="table compact">
                <tbody>
                  {report.incoming.recent.map((r, i) => (
                    <tr key={i} className="static">
                      <td className="small">{r.from_number}</td>
                      <td>{r.text ?? '(attachment)'} {r.quick_reply && <span className="chip">Quick reply</span>}</td>
                      <td className="muted small num">{new Date(r.received_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {report.clicks.by_button.length > 0 && (
            <section className="card pad">
              <h3>Buttons and links</h3>
              <table className="table compact">
                <thead><tr><th>Button</th><th>Type</th><th className="num">People</th><th className="num">Taps</th><th className="num">Of delivered</th></tr></thead>
                <tbody>
                  {report.clicks.by_button.map((b) => (
                    <tr key={b.type + b.label} className="static">
                      <td className="strong">{b.label}</td>
                      <td className="muted">{b.type === 'reply' ? 'Quick reply' : b.type === 'link' ? 'Link button' : 'Text link'}</td>
                      <td className="num">{fmt(b.people)}</td>
                      <td className="num">{fmt(b.taps)}</td>
                      <td className="num">{pctOf(b.people, report.campaign.delivered) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

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
        </div>
      )}
    </>
  );
}

// 42 → "42s", 300 → "5m", 5400 → "1h 30m".
function dur(s: number | null) {
  if (s === null) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  return `${Math.round((s / 86400) * 10) / 10}d`;
}

const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '');

function Tile({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="tile">
      <span className="muted small">{label}</span>
      <b className={bad ? 'bad' : ''}>{value}</b>
      <span className="hint">{sub}</span>
    </div>
  );
}
