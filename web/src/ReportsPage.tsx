import { useEffect, useState } from 'react';
import { api, type Campaign } from './api';

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

export function ReportsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCampaigns()
      .then((c) => {
        const started = c.filter((x) => x.started_at);
        setCampaigns(started);
        setSelected(started[0]?.id ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const current = campaigns.find((c) => c.id === selected);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">Delivery and read rates for each campaign. Rates are out of messages sent.</p>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <div className="card">
          <p className="empty">Loading reports…</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p>No campaigns have run yet.</p>
            <a className="btn" href="#/campaigns">
              Go to campaigns
            </a>
          </div>
        </div>
      ) : (
        <>
          {current && <Funnel c={current} />}
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="num">Recipients</th>
                  <th className="num">Sent</th>
                  <th className="num">Delivered</th>
                  <th className="num">Read</th>
                  <th className="num">Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const s = c.stats;
                  return (
                    <tr key={c.id} className={c.id === selected ? 'selected' : undefined} onClick={() => setSelected(c.id)}>
                      <td>
                        <div className="strong">{c.name}</div>
                        <div className="muted small">
                          {new Date(c.started_at!).toLocaleDateString()} · <span className={`status cs-${c.status}`}>{c.status}</span>
                        </div>
                      </td>
                      <td className="num">{c.total.toLocaleString()}</td>
                      <td className="num">{s.sent.toLocaleString()}</td>
                      <td className="num">
                        {s.delivered.toLocaleString()} <span className="muted small">{pct(s.delivered, s.sent)}</span>
                      </td>
                      <td className="num">
                        {s.read.toLocaleString()} <span className="muted small">{pct(s.read, s.sent)}</span>
                      </td>
                      <td className="num">
                        {(s.failed + s.blocked).toLocaleString()} <span className="muted small">{pct(s.failed + s.blocked, c.total)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Funnel({ c }: { c: Campaign }) {
  const s = c.stats;
  const steps = [
    { label: 'Recipients', value: c.total, note: '' },
    { label: 'Sent', value: s.sent, note: pct(s.sent, c.total) + ' of recipients' },
    { label: 'Delivered', value: s.delivered, note: pct(s.delivered, s.sent) + ' of sent' },
    { label: 'Read', value: s.read, note: pct(s.read, s.sent) + ' of sent' },
  ];
  return (
    <div className="card funnel">
      <div className="row-between">
        <h2>{c.name}</h2>
        <span className="muted small">
          {c.template_name} · {c.list_name}
        </span>
      </div>
      <div className="funnel-rows">
        {steps.map((st) => (
          <div key={st.label} className="funnel-row">
            <span className="funnel-label">{st.label}</span>
            <div className="bar big">
              <span style={{ width: c.total ? `${(st.value / c.total) * 100}%` : 0 }} />
            </div>
            <span className="funnel-value">
              <strong>{st.value.toLocaleString()}</strong> <span className="muted small">{st.note}</span>
            </span>
          </div>
        ))}
      </div>
      {(s.failed > 0 || s.blocked > 0 || s.queued > 0) && (
        <p className="muted small">
          {s.failed > 0 && `${s.failed.toLocaleString()} failed. `}
          {s.blocked > 0 && `${s.blocked.toLocaleString()} blocked by the recipient. `}
          {s.queued > 0 && `${s.queued.toLocaleString()} still waiting to send.`}
        </p>
      )}
    </div>
  );
}
