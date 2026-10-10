import { useEffect, useState } from 'react';
import { api, type Contact, type ContactList, type ImportResult } from './api';
import { Drawer } from './Drawer';

export function ContactListsPage() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ContactList | 'new' | null>(null);

  const load = () =>
    api
      .listLists()
      .then((l) => (setLists(l), setError(null)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => void load(), []);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Contact lists</h1>
          <p className="muted">Upload a CSV with a phone column. Other columns can fill template variables.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen('new')}>
          New list
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="empty">Loading lists…</p>
        ) : lists.length === 0 ? (
          <div className="empty">
            <p>No contact lists yet.</p>
            <button className="btn" onClick={() => setOpen('new')}>
              Upload your first list
            </button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Contacts</th>
                <th>Columns</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} onClick={() => setOpen(l)}>
                  <td className="strong">{l.name}</td>
                  <td className="num">{l.contact_count.toLocaleString()}</td>
                  <td className="muted">{l.columns.length ? l.columns.join(', ') : 'Phone only'}</td>
                  <td className="muted">{new Date(l.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <ListDrawer
          list={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onChanged={(l) => {
            void load();
            setOpen(l);
          }}
        />
      )}
    </>
  );
}

function ListDrawer({
  list,
  onClose,
  onChanged,
}: {
  list: ContactList | null;
  onClose: () => void;
  onChanged: (l: ContactList | null) => void;
}) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    if (list) api.listContacts(list.id).then(setContacts).catch((e) => setError(e.message));
  }, [list]);

  const upload = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    let target = list;
    try {
      if (!target) target = await api.createList(name.trim());
      if (file) {
        const res = await api.importCsv(target.id, await file.text());
        setResult(res);
        setFile(null);
        setFileKey((k) => k + 1);
      }
      const fresh = (await api.listLists()).find((l) => l.id === target!.id) ?? target;
      onChanged(fresh);
    } catch (e) {
      setError((e as Error).message);
      // The list was made but the file was rejected: keep the list open so the user can retry.
      if (target && !list) onChanged(target);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!list || !confirm(`Delete "${list.name}" and its ${list.contact_count} contacts? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteList(list.id);
      onChanged(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const cols = list?.columns ?? [];

  return (
    <Drawer
      title={list ? list.name : 'New contact list'}
      onClose={onClose}
      footer={
        <>
          {list && (
            <button className="btn danger-ghost" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn primary" onClick={upload} disabled={busy || (list ? !file : !name.trim())}>
            {busy ? 'Uploading…' : list ? 'Import CSV' : file ? 'Create and import' : 'Create list'}
          </button>
        </>
      }
    >
      <div className="form single">
        {!list && (
          <label>
            Name
            <input className="input" value={name} maxLength={100} placeholder="e.g. Diwali 2026 customers"
              onChange={(e) => setName(e.target.value)} />
          </label>
        )}

        <label>
          {list ? 'Add or update contacts' : 'CSV file'}
          <input key={fileKey} className="input" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="hint">
            Needs a column named phone, mobile, number or msisdn. 10-digit numbers are read as Indian (+91). Numbers already in
            the list have their other columns updated. Up to 100,000 rows.
          </span>
        </label>

        {error && <div className="banner error">{error}</div>}

        {result && (
          <div className="banner ok">
            Read {result.rows.toLocaleString()} rows: {result.added.toLocaleString()} added, {result.updated.toLocaleString()}{' '}
            updated
            {result.duplicates > 0 && `, ${result.duplicates} repeated in the file`}
            {result.invalid_count > 0 && `, ${result.invalid_count} skipped`}.
            {result.invalid.length > 0 && (
              <ul className="skipped">
                {result.invalid.slice(0, 10).map((r) => (
                  <li key={r.row}>
                    Row {r.row}: {r.value ? <code>{r.value}</code> : null} {r.reason}
                  </li>
                ))}
                {result.invalid_count > 10 && <li>and {result.invalid_count - 10} more</li>}
              </ul>
            )}
          </div>
        )}

        {list && (
          <>
            <div className="facts">
              <div>
                <span className="muted">Contacts</span>
                <strong>{list.contact_count.toLocaleString()}</strong>
              </div>
              <div>
                <span className="muted">Variables available</span>
                <strong>{cols.length ? cols.map((c) => `{{${c}}}`).join(' ') : 'None'}</strong>
              </div>
            </div>

            {contacts.length > 0 && (
              <div className="card scroll-x">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Phone</th>
                      {cols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c) => (
                      <tr key={c.id} className="static">
                        <td>{c.phone}</td>
                        {cols.map((col) => (
                          <td key={col} className={c.attrs[col] ? undefined : 'muted'}>
                            {c.attrs[col] || 'Empty'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {list.contact_count > contacts.length && contacts.length > 0 && (
              <p className="hint">Showing the first {contacts.length} of {list.contact_count.toLocaleString()} contacts.</p>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
