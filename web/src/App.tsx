import { useEffect, useState } from 'react';
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
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TC</span>
          <span>Campaigns</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={route.page === n.path ? 'active' : ''}>{n.label}</a>
          ))}
        </nav>
      </aside>
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
