import { useState } from 'react';
import { apiKeys, type ApiKey } from './api';
import { DOCS_URL, Drawer, PageHead, useAsync, usePoll, when } from './ui';

const DOC_LINKS = [
  { path: 'overview', title: 'Get started', text: 'Base URL, the x-api-key header and your first message.' },
  { path: 'send-message', title: 'Send a message', text: 'Free text or a template, to one number.' },
  { path: 'create-template', title: 'Templates', text: 'Create, submit and preview templates with variables.' },
  { path: 'rich-messages', title: 'Rich messages', text: 'Images, files, link buttons and quick replies.' },
  { path: 'create-campaign', title: 'Campaigns', text: 'Send a template to a contact list, now or later.' },
  { path: 'webhooks', title: 'Webhooks', text: 'Delivered, read and failed events, and signatures.' },
];

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
        action={
          <>
            <a className="btn" href={`${DOCS_URL}/overview`} target="_blank" rel="noreferrer">API documentation ↗</a>
            <button className="btn primary" onClick={() => setCreating(true)}>Create key</button>
          </>
        }
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

      <section className="card pad docs-links">
        <div className="row-between">
          <div>
            <h3>API documentation</h3>
            <p className="muted small">How to authenticate, what to send, and every endpoint with examples you can try.</p>
          </div>
          <a className="btn" href={`${DOCS_URL}/overview`} target="_blank" rel="noreferrer">Open docs ↗</a>
        </div>
        <div className="doc-grid">
          {DOC_LINKS.map((d) => (
            <a key={d.path} className="doc-tile" href={`${DOCS_URL}/${d.path}`} target="_blank" rel="noreferrer">
              <b>{d.title}</b>
              <span className="muted small">{d.text}</span>
            </a>
          ))}
        </div>
        <pre>{`curl -X POST ${location.origin}/v1/messages \\
  -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \\
  -d '{"to":"919999999999","template_id":"TEMPLATE_ID","variables":{"name":"Asha"}}'`}</pre>
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
                <p className="hint">Send it as the <code>x-api-key</code> header. Next: <a className="link" href={`${DOCS_URL}/send-message`} target="_blank" rel="noreferrer">send your first message ↗</a></p>
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
