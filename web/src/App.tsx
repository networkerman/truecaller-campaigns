import { useEffect, useState } from 'react';
import { auth, type Permission, type User } from './api';
import { ApiKeysPage } from './ApiKeysPage';
import { CampaignsPage } from './CampaignsPage';
import { ListsPage } from './ListsPage';
import { ReportsPage } from './ReportsPage';
import { TeamPage } from './TeamPage';
import { TemplatesPage } from './TemplatesPage';
import { WorkspacesPage } from './WorkspacesPage';

// `need` hides a section from roles that can't use it; `superAdmin` sections are OneXtel-only.
const NAV: { path: string; label: string; need?: Permission; superAdmin?: boolean }[] = [
  { path: 'campaigns', label: 'Campaigns' },
  { path: 'templates', label: 'Templates' },
  { path: 'lists', label: 'Contact lists' },
  { path: 'reports', label: 'Reports' },
  { path: 'api-keys', label: 'API keys', need: 'keys:manage' },
  { path: 'team', label: 'Team' },
  { path: 'workspaces', label: 'All workspaces', superAdmin: true },
];

const parse = () => {
  const [page = 'campaigns', id = null] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: NAV.some((n) => n.path === page) ? page : 'campaigns', id };
};

const roleLabel = (r: string) => r[0].toUpperCase() + r.slice(1);

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
  if (!user) return <SignIn onSignedIn={loadUser} />;
  if (user.must_change_password) return <ChangePassword user={user} onDone={loadUser} />;

  const signOut = async () => {
    await auth.logout().catch(() => {});
    setUser(null);
  };
  if (!user.workspace) {
    return (
      <div className="signin">
        <div className="card signin-card">
          <Brand dark />
          <h1>No workspace yet</h1>
          <p className="muted">Your account isn't in any workspace. Ask whoever invited you to add you again.</p>
          <button className="btn wide" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  const ws = user.workspace;
  // Remount the pages on switch so nothing from the previous workspace stays on screen.
  const switchTo = async (id: string) => {
    await auth.switchWorkspace(id);
    await loadUser();
    location.hash = '#/campaigns';
  };
  const nav = NAV.filter((n) => (n.superAdmin ? user.super_admin : !n.need || user.permissions.includes(n.need)));
  const page = nav.some((n) => n.path === route.page) ? route.page : 'campaigns';
  const links = nav.map((n) => (
    <a key={n.path} href={`#/${n.path}`} className={page === n.path ? 'active' : ''}>{n.label}</a>
  ));

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="ws">
          {user.workspaces.length > 1 ? (
            <select className="ws-select" value={ws.id} onChange={(e) => switchTo(e.target.value)} aria-label="Workspace">
              {user.workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.role ? '' : ' (support)'}</option>
              ))}
            </select>
          ) : (
            <div className="ws-name">{ws.name}</div>
          )}
          <div className="ws-role">{ws.support ? 'Support access' : roleLabel(ws.role)}</div>
        </div>
        <nav>{links}</nav>
        <div className="whoami" title={user.email}>{user.name}{user.super_admin && <small className="sa">Super admin</small>}</div>
        <button className="signout" onClick={signOut}>Sign out</button>
      </aside>
      <nav className="topnav" aria-label="Sections">{links}</nav>
      <main className="content" key={ws.id}>
        {ws.support && <div className="banner warn">You're in {ws.name} with support access. What you do here is recorded in its audit log.</div>}
        {page === 'campaigns' && <CampaignsPage />}
        {page === 'templates' && <TemplatesPage />}
        {page === 'lists' && <ListsPage />}
        {page === 'reports' && <ReportsPage id={route.id} onSelect={(id) => (location.hash = `#/reports/${id}`)} />}
        {page === 'api-keys' && <ApiKeysPage />}
        {page === 'team' && <TeamPage user={user} />}
        {page === 'workspaces' && <WorkspacesPage onOpen={switchTo} />}
      </main>
    </div>
  );
}

function Brand({ dark }: { dark?: boolean }) {
  return (
    <div className={dark ? 'brand dark' : 'brand'}>
      <span className="brand-mark">TC</span>
      <span>Campaigns</span>
    </div>
  );
}

// There is no signup: people get an invitation email with a temporary password.
function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <Brand dark />
        <h1>Sign in</h1>
        <p className="muted">Use the email you were invited with. First time? Use the temporary password from your invitation.</p>
        <label className="field">
          Email
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="banner error">{error}</div>}
        <button className="btn primary wide" disabled={busy || !email.trim() || !password}>{busy ? 'One moment…' : 'Sign in'}</button>
        <p className="muted switch small">No account? Access is by invitation from your workspace Owner or OneXtel.</p>
      </form>
    </div>
  );
}

function ChangePassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = Boolean(again) && next !== again;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <Brand dark />
        <h1>Choose your password</h1>
        <p className="muted">Welcome, {user.name}. Replace the temporary password from your invitation with one only you know.</p>
        <input type="email" hidden readOnly autoComplete="username" value={user.email} />
        <label className="field">
          Temporary password
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </label>
        <label className="field">
          New password
          <input className="input" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="muted small">At least 10 characters.</span>
        </label>
        <label className="field">
          New password again
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          {mismatch && <span className="small err-text">The passwords don't match.</span>}
        </label>
        {error && <div className="banner error">{error}</div>}
        <button className="btn primary wide" disabled={busy || !current || next.length < 10 || next !== again}>
          {busy ? 'One moment…' : 'Save and continue'}
        </button>
        <p className="switch"><button type="button" className="link" onClick={() => auth.logout().then(onDone, onDone)}>Sign out</button></p>
      </form>
    </div>
  );
}
