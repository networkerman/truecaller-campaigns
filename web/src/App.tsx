import { TemplatesPage } from './TemplatesPage';

const NAV = [
  { label: 'Templates', ready: true },
  { label: 'Campaigns', ready: false },
  { label: 'Contact lists', ready: false },
  { label: 'Reports', ready: false },
  { label: 'API keys', ready: false },
];

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TC</span>
          <span>Campaigns</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <a key={n.label} className={n.ready ? 'active' : 'disabled'} aria-disabled={!n.ready}>
              {n.label}
              {!n.ready && <small>Soon</small>}
            </a>
          ))}
        </nav>
      </aside>
      <main className="content">
        <TemplatesPage />
      </main>
    </div>
  );
}
