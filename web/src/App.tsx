import { useEffect, useState } from 'react';
import { auth, type Permission, type User } from './api';
import { ApiKeysPage } from './ApiKeysPage';
import { CampaignsPage } from './CampaignsPage';
import { ListsPage } from './ListsPage';
import { ReportsPage } from './ReportsPage';
import { SendersPage } from './SendersPage';
import { TeamPage } from './TeamPage';
import { TemplatesPage } from './TemplatesPage';
import { useTestMode } from './testMode';
import { WebhooksPage } from './WebhooksPage';
import { WorkspacesPage } from './WorkspacesPage';

// `need` hides a section from roles that can't use it; `superAdmin` sections are OneXtel-only.
const NAV: { path: string; label: string; group: string; need?: Permission; superAdmin?: boolean }[] = [
  { path: 'campaigns', label: 'Campaigns', group: 'Messaging' },
  { path: 'templates', label: 'Templates', group: 'Messaging' },
  { path: 'lists', label: 'Contact lists', group: 'Messaging' },
  { path: 'reports', label: 'Reports', group: 'Messaging' },
  { path: 'api-keys', label: 'API keys', group: 'Developers', need: 'keys:manage' },
  { path: 'webhooks', label: 'Webhooks', group: 'Developers', need: 'keys:manage' },
  { path: 'senders', label: 'Senders', group: 'Settings', need: 'reports:view' },
  { path: 'team', label: 'Team', group: 'Settings' },
  { path: 'workspaces', label: 'All workspaces', group: 'OneXtel', superAdmin: true },
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
  const testMode = useTestMode();
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
  const link = (n: (typeof NAV)[number]) => (
    <a key={n.path} href={`#/${n.path}`} className={page === n.path ? 'active' : ''}>{n.label}</a>
  );
  const links = nav.map(link);
  const groups = [...new Set(nav.map((n) => n.group))];

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
        <nav>
          {groups.map((g) => (
            <div key={g} className="nav-group">
              {g !== 'Messaging' && <div className="nav-label">{g}</div>}
              {nav.filter((n) => n.group === g).map(link)}
            </div>
          ))}
        </nav>
        <div className="whoami" title={user.email}>{user.name}{user.super_admin && <small className="sa">Super admin</small>}</div>
        <button className="signout" onClick={signOut}>Sign out</button>
      </aside>
      <nav className="topnav" aria-label="Sections">{links}</nav>
      <main className="content" key={ws.id}>
        {testMode && (
          <div className="banner test-mode" role="status">
            <strong>Test mode.</strong> Messages are simulated and nothing is sent to phones. Delivered and read
            results are generated automatically, and submitted templates are approved without Truecaller review.
          </div>
        )}
        {ws.support && <div className="banner warn">You're in {ws.name} with support access. What you do here is recorded in its audit log.</div>}
        {page === 'campaigns' && <CampaignsPage />}
        {page === 'templates' && <TemplatesPage />}
        {page === 'lists' && <ListsPage />}
        {page === 'reports' && <ReportsPage id={route.id} onSelect={(id) => (location.hash = `#/reports/${id}`)} />}
        {page === 'api-keys' && <ApiKeysPage />}
        {page === 'webhooks' && <WebhooksPage />}
        {page === 'senders' && <SendersPage canRequest={user.permissions.includes('campaigns:manage')} />}
        {page === 'team' && <TeamPage user={user} />}
        {page === 'workspaces' && <WorkspacesPage onOpen={switchTo} />}
      </main>
    </div>
  );
}

function Brand({ dark }: { dark?: boolean }) {
  return (
    <div className={dark ? 'brand dark' : 'brand'}>
      <XMark />
      <span className="brand-name">OneXtel<small>Truecaller campaigns</small></span>
    </div>
  );
}

// OneXtel X mark, drawn from the brand guidelines. Swap for the official SVG when we have it.
export function XMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#D72327" />
      <path d="M9 9l14 14M23 9L9 23" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" />
    </svg>
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
      <Showcase />
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

const FEATURES = [
  { tone: 'mint', title: 'Verified sender', text: 'Your brand name and verified badge on every message.',
    icon: <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zm-3 9l2 2 4-4" /> },
  { tone: 'sky', title: 'Personal, from Excel', text: 'Upload a sheet and every column fills a {{variable}}, with defaults for blanks.',
    icon: <path d="M4 4h16v16H4zM4 9h16M9 9v11" /> },
  { tone: 'peach', title: 'Reports that add up', text: 'Delivered, read and clicked, with timings and a reason for every failure.',
    icon: <path d="M5 20V10M10 20V4M15 20v-7M20 20v-4" /> },
  { tone: 'lilac', title: 'Scheduled and safe', text: 'Send now or later. Opt-outs and promotional limits are applied for you.',
    icon: <path d="M4 7h16v13H4zM8 3v4M16 3v4M12 11v4l2 2" /> },
];

// Left half of the sign-in screen: what the product does, with a sample message.
function Showcase() {
  return (
    <section className="showcase" aria-label="About Truecaller campaigns">
      <p className="eyebrow">Truecaller business messaging</p>
      <h2>Verified messages, on the screen your customers already trust.</h2>
      <p className="lede">Plan, personalise, send and measure Truecaller campaigns from one OneXtel workspace.</p>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className={`feature ${f.tone}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{f.icon}</svg>
            <b>{f.title}</b>
            <span>{f.text}</span>
          </div>
        ))}
      </div>
      <div className="mock-chat" aria-hidden="true">
        <div className="mock-head">
          <span className="avatar">YB</span>
          <div><b>Your Brand</b> <span className="tick">✓</span><div className="muted small">Verified business</div></div>
        </div>
        <div className="mock-bubble">Hi Asha, a quick safety reminder: never share OTPs or card details from unexpected messages or calls.</div>
        <div className="mock-meta">Delivered · Read</div>
      </div>
    </section>
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
      <Showcase />
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
