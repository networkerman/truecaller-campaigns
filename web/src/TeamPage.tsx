import { useState } from 'react';
import { ROLES, team, type AuditEntry, type Member, type Role, type User } from './api';
import { Drawer, PageHead, useAsync, usePoll, when } from './ui';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including managing Owners.',
  admin: 'Everything except managing Owners.',
  developer: 'Templates, contact lists, campaigns and API keys.',
  analyst: 'Read only: campaigns, templates, lists and reports.',
};
const label = (r: string) => r[0].toUpperCase() + r.slice(1);

export function TeamPage({ user }: { user: User }) {
  const [data, setData] = useState<Member[] | null>(null);
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'developer' as Role });
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  const manage = user.permissions.includes('members:manage');
  const isOwner = user.workspace?.role === 'owner';
  const ws = user.workspace!.name;

  const load = () => {
    team.all().then(setData);
    if (manage) team.audit().then(setLog);
  };
  usePoll(load, 0, false);

  const invite = () =>
    run(async () => {
      const m = await team.invite({ ...form, email: form.email.trim(), name: form.name.trim() });
      setNotice(m.pending
        ? `Invitation sent to ${form.email.trim()} with a temporary password.`
        : `${form.email.trim()} already had an account and was added. They'll see ${ws} when they sign in.`);
      setForm({ name: '', email: '', role: 'developer' });
      setInviting(false);
      load();
    });
  const setRole = (m: Member, role: Role) => run(() => team.setRole(m.user_id, role).then(load));
  const remove = (m: Member) =>
    confirm(`Remove ${m.name} (${m.email}) from ${ws}? They lose access straight away.`) && run(() => team.remove(m.user_id).then(load));
  const resend = (m: Member) => run(async () => (await team.resend(m.user_id), setNotice(`New temporary password sent to ${m.email}.`)));

  // Only Owners can grant or change Owner.
  const roleChoices = (current: Role) => ROLES.filter((r) => isOwner || (r !== 'owner' && current !== 'owner'));

  return (
    <>
      <PageHead
        title="Team"
        sub={`People in ${ws} and what they can do.`}
        action={manage && <button className="btn primary" onClick={() => setInviting(true)}>Invite someone</button>}
      />
      {notice && <div className="banner warn">{notice}</div>}
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        {!data ? (
          <p className="empty">Loading team…</p>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.user_id} className="static">
                  <td className="strong">{m.name}{m.user_id === user.id && <span className="muted"> (you)</span>}</td>
                  <td>{m.email}</td>
                  <td>
                    {manage && m.user_id !== user.id && roleChoices(m.role).includes(m.role) ? (
                      <select className="input role-select" value={m.role} disabled={busy} onChange={(e) => setRole(m, e.target.value as Role)}>
                        {roleChoices(m.role).map((r) => <option key={r} value={r}>{label(r)}</option>)}
                      </select>
                    ) : (
                      <span className={`status st-${m.role}`}>{label(m.role)}</span>
                    )}
                    {m.pending && <span className="status st-pending"> invited</span>}
                  </td>
                  <td className="muted">{when(m.joined_at)}</td>
                  <td className="num">
                    {manage && m.pending && <button className="btn small" disabled={busy} onClick={() => resend(m)}>Resend</button>}{' '}
                    {manage && m.user_id !== user.id && (isOwner || m.role !== 'owner') && (
                      <button className="btn danger-ghost small" disabled={busy} onClick={() => remove(m)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card pad docs">
        <h3>Roles</h3>
        {ROLES.map((r) => <p key={r} className="hint"><strong>{label(r)}:</strong> {ROLE_HELP[r]}</p>)}
      </section>

      {manage && log && log.length > 0 && (
        <section className="card">
          <h3 className="pad-s">Audit log</h3>
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {log.map((a) => (
                <tr key={a.id} className="static">
                  <td className="muted">{when(a.created_at)}</td>
                  <td>{a.actor ?? 'System'}</td>
                  <td><code>{a.action}</code></td>
                  <td className="muted small">{a.detail ? Object.entries(a.detail).filter(([k]) => !k.endsWith('id')).map(([k, v]) => `${k}: ${v}`).join(', ') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {inviting && (
        <Drawer
          title={`Invite to ${ws}`}
          onClose={() => setInviting(false)}
          narrow
          footer={<><div className="spacer" /><button className="btn primary" disabled={busy || !form.name.trim() || !form.email.trim()} onClick={invite}>{busy ? 'Sending…' : 'Send invitation'}</button></>}
        >
          <div className="form pad">
            <label>
              Name
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Email
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Role
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.filter((r) => isOwner || r !== 'owner').map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </select>
              <span className="hint">{ROLE_HELP[form.role]}</span>
            </label>
            <p className="hint">They get an email with a temporary password, and choose their own at first sign-in. The temporary password works for 7 days.</p>
            {error && <div className="banner error">{error}</div>}
          </div>
        </Drawer>
      )}
    </>
  );
}
