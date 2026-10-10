import { useState } from 'react';
import { lists, type ContactList, type ListDetail, type UploadResult } from './api';
import { Drawer, PageHead, fmt, useAsync, usePoll, when } from './ui';

export function ListsPage() {
  const [data, setData] = useState<ContactList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const load = () => lists.all().then(setData, (e) => setError(e.message));
  usePoll(load, 0, false);

  return (
    <>
      <PageHead
        title="Contact lists"
        sub="Upload a CSV with a phone column. Every other column can be used in templates as {{column}}."
        action={<button className="btn primary" onClick={() => setOpen('new')}>New list</button>}
      />
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        {!data ? (
          <p className="empty">Loading lists…</p>
        ) : data.length === 0 ? (
          <div className="empty">
            <p>No contact lists yet.</p>
            <button className="btn" onClick={() => setOpen('new')}>Upload your first list</button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Contacts</th><th>Columns</th><th>Created</th></tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} onClick={() => setOpen(l.id)}>
                  <td className="strong">{l.name}</td>
                  <td>{fmt(l.contact_count)}</td>
                  <td className="muted">{l.columns.length ? l.columns.join(', ') : 'Phone only'}</td>
                  <td className="muted">{when(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <ListDrawer id={open === 'new' ? null : open} onClose={() => setOpen(null)} onChanged={(id) => (load(), setOpen(id))} />}
    </>
  );
}

function ListDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: (id: string | null) => void }) {
  const [list, setList] = useState<ListDetail | null>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const { busy, error, run } = useAsync();
  usePoll(() => void (id && lists.get(id).then(setList)), 0, false);

  const save = () =>
    run(async () => {
      let listId = id;
      if (!listId) listId = (await lists.create(name.trim())).id;
      if (file) setResult(await lists.upload(listId, file));
      setFile(null);
      setList(await lists.get(listId));
      onChanged(listId);
    });

  const remove = () => confirm(`Delete "${list!.name}" and its contacts?`) && run(() => lists.remove(list!.id).then(() => onChanged(null)));

  return (
    <Drawer
      title={id ? list?.name ?? 'Contact list' : 'New contact list'}
      onClose={onClose}
      narrow
      footer={
        <>
          {list && <button className="btn danger-ghost" onClick={remove} disabled={busy}>Delete</button>}
          <div className="spacer" />
          <button className="btn primary" onClick={save} disabled={busy || (!id && !name.trim()) || (!!id && !file)}>
            {busy ? 'Uploading…' : id ? 'Upload contacts' : file ? 'Create and upload' : 'Create list'}
          </button>
        </>
      }
    >
      <div className="form pad">
        {!id && (
          <label>
            List name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali 2026 high-value buyers" />
          </label>
        )}
        <label className="dropzone">
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="strong">{file ? file.name : 'Choose a CSV file'}</span>
          <span className="hint">
            {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Needs a phone or mobile column. 10-digit numbers are treated as Indian (+91). Re-uploading updates existing contacts.'}
          </span>
        </label>
        <p className="hint">
          Columns other than phone become template variables: <code>first_name</code> fills <code>{'{{first_name}}'}</code>.{' '}
          <a href="/sample-contacts.csv" download="sample-contacts.csv">Download a sample CSV</a>
        </p>

        {error && <div className="banner error">{error}</div>}
        {result && (
          <div className="banner ok">
            Added {fmt(result.added)}, updated {fmt(result.updated)} from {fmt(result.rows)} rows (phone column: {result.phone_column}).
            {result.duplicates_in_file > 0 && ` ${fmt(result.duplicates_in_file)} duplicates merged.`}
            {result.invalid > 0 && (
              <> {fmt(result.invalid)} invalid {result.invalid === 1 ? "number" : "numbers"} skipped{result.invalid_samples.length > 0 && `, e.g. row ${result.invalid_samples.map((s) => `${s.row} (${s.value || 'empty'})`).slice(0, 3).join(', ')}`}.</>
            )}
          </div>
        )}

        {list && (
          <>
            <div className="stat-row">
              <div className="stat"><span>Contacts</span><b>{fmt(list.contact_count)}</b></div>
              <div className="stat"><span>Template variables</span><b className="small">{list.columns.length ? list.columns.map((c) => `{{${c}}}`).join(' ') : 'None'}</b></div>
            </div>
            {list.sample.length > 0 && (
              <div className="card">
                <table className="table compact">
                  <thead>
                    <tr><th>Phone</th>{list.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {list.sample.map((c) => (
                      <tr key={c.phone} className="static">
                        <td>{c.phone} {c.opted_out && <span className="status st-rejected">opted out</span>}</td>
                        {list.columns.map((k) => <td key={k} className="muted">{c.attributes[k] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {list.contact_count > list.sample.length && <p className="hint pad-s">Showing first {list.sample.length} of {fmt(list.contact_count)}.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
