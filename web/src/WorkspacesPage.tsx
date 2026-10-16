import { useState } from 'react';
import { admin, type WorkspaceRow } from './api';
import { Drawer, PageHead, fmt, useAsync, usePoll, when } from './ui';

// OneXtel super admins only: every customer workspace, and creating a new one for a customer.
export function WorkspacesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<WorkspaceRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', owner_name: '', owner_email: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  const load = () => admin.workspaces().then(setData);
  usePoll(load, 0, false);

  const create = () =>
    run(async () => {
      const w = await admin.createWorkspace({ ...form, owner_email: form.owner_email.trim() });
      setNotice(`${w.name} created. ${form.owner_email.trim()} got an invitation and is its Owner.`);
      setForm({ name: '', owner_name: '', owner_email: '' });
      setCreating(false);
      load();
    });

  return (
    <>
      <PageHead
        title="All workspaces"
        sub="Customer workspaces. Each has its own campaigns, lists, templates, API keys and team."
        action={<button className="btn primary" onClick={() => setCreating(true)}>New workspace</button>}
      />
      {notice && <div className="banner warn">{notice}</div>}
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        {!data ? (
          <p className="empty">Loading workspaces…</p>
        ) : (
          <table className="table">
            <thead><tr><th>Workspace</th><th>Owners</th><th className="num">Members</th><th className="num">Campaigns</th><th>Created</th><th /></tr></thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id} className="static">
                  <td className="strong">{w.name}</td>
                  <td>{w.owners?.join(', ') ?? <span className="muted">None</span>}</td>
                  <td className="num">{fmt(w.members)}</td>
                  <td className="num">{fmt(w.campaigns)}</td>
                  <td className="muted">{when(w.created_at)}</td>
                  <td className="num"><button className="btn small" onClick={() => onOpen(w.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <Drawer
          title="New workspace"
          onClose={() => setCreating(false)}
          narrow
          footer={
            <><div className="spacer" /><button className="btn primary" disabled={busy || !form.name.trim() || !form.owner_name.trim() || !form.owner_email.trim()} onClick={create}>{busy ? 'Creating…' : 'Create and invite'}</button></>
          }
        >
          <div className="form pad">
            <label>
              Workspace name
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Retail" />
            </label>
            <label>
              Owner's name
              <input className="input" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
            </label>
            <label>
              Owner's email
              <input className="input" type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
              <span className="hint">They become the workspace's Owner, get a temporary password by email, and can invite their own team.</span>
            </label>
            {error && <div className="banner error">{error}</div>}
          </div>
        </Drawer>
      )}
    </>
  );
}
