import { useEffect, useState } from 'react';
import { auth, type User } from './api';
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
  // undefined while checking the session cookie, null when signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const loadUser = () => auth.me().then(setUser, () => setUser(null));
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    auth.onUnauthorized(() => setUser(null));
    loadUser();
    return () => window.removeEventListener('hashchange', on);
  }, []);

  if (user === undefined) return null;
  if (!user) return <AuthScreen onSignedIn={loadUser} />;

  const signOut = async () => {
    await auth.logout().catch(() => {});
    setUser(null);
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
        <div className="whoami" title={user.email}>{user.name}</div>
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

const verifyFailed = () => location.hash.includes('verify=failed');

function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    verifyFailed() ? 'That confirmation link has expired or was already used. Sign up again to get a new one.' : null,
  );
  const [sentTo, setSentTo] = useState<string | null>(null);

  const switchTo = (m: 'signin' | 'signup') => {
    setMode(m);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const r = await auth.signup(name.trim(), email.trim(), password);
        setSentTo(r.email);
      } else {
        await auth.login(email.trim(), password);
        if (verifyFailed()) location.hash = '#/campaigns';
        onSignedIn();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const brand = (
    <div className="brand dark">
      <span className="brand-mark">TC</span>
      <span>Campaigns</span>
    </div>
  );

  if (sentTo) {
    return (
      <div className="signin">
        <div className="card signin-card">
          {brand}
          <h1>Check your inbox</h1>
          <p className="muted">
            We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish signing up. The link works for 24 hours.
          </p>
          <button className="btn wide" onClick={() => (setSentTo(null), switchTo('signin'))}>Back to sign in</button>
        </div>
      </div>
    );
  }

  const signup = mode === 'signup';
  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        {brand}
        <h1>{signup ? 'Create your account' : 'Sign in'}</h1>
        <p className="muted">{signup ? 'Use your OneXtel work email.' : 'Use your OneXtel work email and password.'}</p>
        {signup && (
          <label className="field">
            Name
            <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
        )}
        <label className="field">
          Work email
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!signup} />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup && <span className="muted small">At least 8 characters.</span>}
        </label>
        {error && <div className="banner error">{error}</div>}
        <button className="btn primary wide" disabled={busy || !email.trim() || !password || (signup && !name.trim())}>
          {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
        </button>
        <p className="muted switch">
          {signup ? 'Already have an account? ' : 'New here? '}
          <button type="button" className="link" onClick={() => switchTo(signup ? 'signin' : 'signup')}>
            {signup ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </div>
  );
}
