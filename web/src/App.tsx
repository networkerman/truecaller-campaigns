import { useEffect, useState } from 'react';
import { checkKey, session } from './api';
import { ApiKeysPage } from './ApiKeysPage';
import { CampaignsPage } from './CampaignsPage';
import { ListsPage } from './ListsPage';
import { ReportsPage } from './ReportsPage';
import { TemplatesPage } from './TemplatesPage';

const NAV = [
  { path: 'campaigns', label: 'Campaigns' },
  { path: 'templates', label: 'Templates' },
  { path: 'lists', label: 'Contact lists' },
  { path: 'reports', label: 'Reports' },
  { path: 'api-keys', label: 'API keys' },
];

const parse = () => {
  const [page = 'campaigns', id = null] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: NAV.some((n) => n.path === page) ? page : 'campaigns', id };
};

export function App() {
  const [route, setRoute] = useState(parse);
  const [signedIn, setSignedIn] = useState(session.signedIn);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    session.onUnauthorized(() => setSignedIn(false));
    return () => window.removeEventListener('hashchange', on);
  }, []);

  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;

  const signOut = () => {
    session.clear();
    setSignedIn(false);
  };
  const links = NAV.map((n) => (
    <a key={n.path} href={`#/${n.path}`} className={route.page === n.path ? 'active' : ''}>{n.label}</a>
  ));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TC</span>
          <span>Campaigns</span>
        </div>
        <nav>{links}</nav>
        <button className="signout" onClick={signOut}>Sign out</button>
      </aside>
      <nav className="topnav" aria-label="Sections">{links}</nav>
      <main className="content">
        {route.page === 'campaigns' && <CampaignsPage />}
        {route.page === 'templates' && <TemplatesPage />}
        {route.page === 'lists' && <ListsPage />}
        {route.page === 'reports' && <ReportsPage id={route.id} onSelect={(id) => (location.hash = `#/reports/${id}`)} />}
        {route.page === 'api-keys' && <ApiKeysPage />}
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
      if (await checkKey(key.trim())) {
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
