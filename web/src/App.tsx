import { useEffect, useState } from 'react';
import { api, session, setUnauthorizedHandler } from './api';
import { ApiKeysPage } from './ApiKeysPage';
import { CampaignsPage } from './CampaignsPage';
import { ContactListsPage } from './ContactListsPage';
import { ReportsPage } from './ReportsPage';
import { TemplatesPage } from './TemplatesPage';

const NAV = [
  { path: 'templates', label: 'Templates', Page: TemplatesPage },
  { path: 'campaigns', label: 'Campaigns', Page: CampaignsPage },
  { path: 'lists', label: 'Contact lists', Page: ContactListsPage },
  { path: 'reports', label: 'Reports', Page: ReportsPage },
  { path: 'api-keys', label: 'API keys', Page: ApiKeysPage },
] as const;

const currentPath = () => window.location.hash.replace(/^#\/?/, '') || 'templates';

export function App() {
  const [path, setPath] = useState(currentPath);
  const [signedIn, setSignedIn] = useState(() => Boolean(session.get()));

  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    setUnauthorizedHandler(() => {
      session.clear();
      setSignedIn(false);
    });
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;

  const active = NAV.find((n) => n.path === path) ?? NAV[0];
  const signOut = () => {
    session.clear();
    setSignedIn(false);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TC</span>
          <span>Campaigns</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={n === active ? 'active' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <button className="signout" onClick={signOut}>
          Sign out
        </button>
      </aside>
      <nav className="topnav" aria-label="Sections">
        {NAV.map((n) => (
          <a key={n.path} href={`#/${n.path}`} className={n === active ? 'active' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
      <main className="content">
        <active.Page />
      </main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState(import.meta.env.DEV ? 'dev-key' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await api.checkKey(key.trim())) {
        session.set(key.trim());
        onDone();
      } else setError('That key was not accepted. Check it has not been revoked.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <div className="brand dark">
          <span className="brand-mark">TC</span>
          <span>Campaigns</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Enter an API key. It is kept in this browser only.</p>
        <label className="field">
          API key
          <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        </label>
        {error && <div className="banner error">{error}</div>}
        <button className="btn primary wide" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
