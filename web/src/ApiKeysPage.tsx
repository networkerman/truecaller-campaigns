import { useState } from 'react';
import { apiKeys, type ApiKey } from './api';
import { Drawer, PageHead, useAsync, usePoll, when } from './ui';

export function ApiKeysPage() {
  const [data, setData] = useState<ApiKey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAsync();
  const load = () => apiKeys.all().then(setData);
  usePoll(load, 0, false);

  const create = () => run(async () => (setCreated(await apiKeys.create(name.trim())), setName(''), load()));
  const revoke = (k: ApiKey) => confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`) && run(() => apiKeys.revoke(k.id).then(load));
  const close = () => (setCreating(false), setCreated(null), setCopied(false));

  return (
    <>
      <PageHead
        title="API keys"
        sub="Give each customer or integration its own key. Send it as the x-api-key header on every /v1 request."
        action={<button className="btn primary" onClick={() => setCreating(true)}>Create key</button>}
      />
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        {!data ? (
          <p className="empty">Loading keys…</p>
        ) : data.length === 0 ? (
          <div className="empty"><p>No API keys yet.</p><button className="btn" onClick={() => setCreating(true)}>Create your first key</button></div>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id} className="static">
                  <td className="strong">{k.name}</td>
                  <td><code>{k.prefix}…</code></td>
                  <td className="muted">{when(k.created_at)}</td>
                  <td className="muted">{k.last_used_at ? when(k.last_used_at) : 'Never'}</td>
                  <td><span className={`status ${k.revoked_at ? 'st-rejected' : 'st-approved'}`}>{k.revoked_at ? 'revoked' : 'active'}</span></td>
                  <td className="num">{!k.revoked_at && <button className="btn danger-ghost small" disabled={busy} onClick={() => revoke(k)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card pad docs">
        <h3>Quick start</h3>
        <pre>{`curl -X POST ${location.origin}/v1/messages \\
  -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \\
  -d '{"to":"9876543210","template_id":"TEMPLATE_ID","variables":{"name":"Asha"}}'`}</pre>
        <p className="hint">Other endpoints: /v1/templates, /v1/lists (CSV upload with Content-Type: text/csv), /v1/campaigns, /v1/campaigns/:id/report. To get delivery and read updates pushed to you, add an endpoint on the <a className="link" href="#/webhooks">Webhooks</a> page.</p>
      </section>

      {creating && (
        <Drawer
          title={created ? 'Key created' : 'Create API key'}
          onClose={close}
          narrow
          footer={
            created ? (
              <><div className="spacer" /><button className="btn primary" onClick={close}>Done</button></>
            ) : (
              <><div className="spacer" /><button className="btn primary" disabled={busy || !name.trim()} onClick={create}>Create key</button></>
            )
          }
        >
          <div className="form pad">
            {created ? (
              <>
                <div className="banner warn">Copy this key now. It won't be shown again.</div>
                <div className="key-box">
                  <code>{created.key}</code>
                  <button className="btn small" onClick={() => navigator.clipboard.writeText(created.key!).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </>
            ) : (
              <label>
                Name
                <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Retail, production" />
                <span className="hint">Helps you tell keys apart later.</span>
              </label>
            )}
            {error && <div className="banner error">{error}</div>}
          </div>
        </Drawer>
      )}
    </>
  );
}
