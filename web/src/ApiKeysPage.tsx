import { useEffect, useState } from 'react';
import { api, type ApiKey } from './api';

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    api
      .listKeys()
      .then((k) => (setKeys(k), setError(null)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => void load(), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const k = await api.createKey(name.trim());
      setCreated({ name: k.name, key: k.key });
      setCopied(false);
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke "${k.name}"? Anything using this key stops working straight away.`)) return;
    try {
      await api.revokeKey(k.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created!.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>API keys</h1>
          <p className="muted">
            Keys for the <code>x-api-key</code> header on the API. Each key can also sign in to this dashboard.
          </p>
        </div>
      </header>

      <form className="card inline-form" onSubmit={create}>
        <input className="input" placeholder="Key name, e.g. CRM integration" value={name} maxLength={100}
          onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim()}>
          Create key
        </button>
      </form>

      {created && (
        <div className="banner ok key-reveal">
          <div>
            <strong>{created.name}</strong> created. Copy it now: it won't be shown again.
          </div>
          <div className="key-row">
            <code className="key">{created.key}</code>
            <button className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="link" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="empty">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="empty">No keys created here yet. The setup key from deployment still works.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.revoked_at ? 'static revoked' : 'static'}>
                  <td className="strong">{k.name}</td>
                  <td>
                    <code>{k.prefix}…</code>
                  </td>
                  <td className="muted">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                  <td className="num">
                    {k.revoked_at ? (
                      <span className="status st-rejected">revoked</span>
                    ) : (
                      <button className="btn danger-ghost" onClick={() => revoke(k)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
