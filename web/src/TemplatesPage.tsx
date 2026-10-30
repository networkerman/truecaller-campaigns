import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Category, type Template, type TemplateInput } from './api';

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const MAX_LEN = 1000;
const CATEGORIES: { value: Category; label: string; hint: string }[] = [
  { value: 'promotional', label: 'Promotional', hint: 'Offers and marketing. Subject to tier limits and 4 sends per user every 28 days.' },
  { value: 'transactional', label: 'Transactional', hint: 'OTPs, order and payment updates.' },
  { value: 'service', label: 'Service', hint: 'Account notices, reminders and alerts.' },
];

const variablesOf = (body: string) => [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
const fill = (body: string, values: Record<string, string>) =>
  body.replace(PLACEHOLDER, (_, v: string) => values[v] || `{{${v}}}`);

type Editing = { mode: 'new' } | { mode: 'edit'; template: Template } | null;

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Template['status']>('all');
  const [editing, setEditing] = useState<Editing>(null);

  const load = () =>
    api
      .listTemplates()
      .then((t) => (setTemplates(t), setError(null)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => void load(), []);

  const shown = templates.filter(
    (t) => (filter === 'all' || t.status === filter) && t.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Templates</h1>
          <p className="muted">Reusable messages for campaigns and the API. Only approved templates can be sent.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ mode: 'new' })}>
          New template
        </button>
      </header>

      <div className="toolbar">
        <input className="input" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="tabs">
          {(['all', 'draft', 'submitted', 'approved', 'rejected'] as const).map((s) => (
            <button key={s} className={filter === s ? 'tab on' : 'tab'} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="empty">Loading templates…</p>
        ) : shown.length === 0 ? (
          <div className="empty">
            {templates.length === 0 ? (
              <>
                <p>No templates yet.</p>
                <button className="btn" onClick={() => setEditing({ mode: 'new' })}>
                  Create your first template
                </button>
              </>
            ) : (
              <p>No templates match this filter.</p>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Variables</th>
                <th>Status</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} onClick={() => setEditing({ mode: 'edit', template: t })}>
                  <td>
                    <div className="strong">{t.name}</div>
                    <div className="muted clip">{t.body}</div>
                  </td>
                  <td>
                    <span className={`chip cat-${t.category}`}>{t.category}</span>
                  </td>
                  <td className="muted">{t.variables.length ? t.variables.join(', ') : 'None'}</td>
                  <td>
                    <span className={`status st-${t.status}`}>{t.status}</span>
                  </td>
                  <td className="muted">{new Date(t.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <Editor
          key={editing.mode === 'edit' ? editing.template.id : 'new'}
          template={editing.mode === 'edit' ? editing.template : null}
          onClose={() => setEditing(null)}
          onChanged={(t) => {
            void load();
            setEditing(t ? { mode: 'edit', template: t } : null);
          }}
        />
      )}
    </>
  );
}

function Editor({
  template,
  onClose,
  onChanged,
}: {
  template: Template | null;
  onClose: () => void;
  onChanged: (t: Template | null) => void;
}) {
  const [form, setForm] = useState<TemplateInput>(
    template
      ? { name: template.name, category: template.category, body: template.body, variable_defaults: { ...template.variable_defaults } }
      : { name: '', category: 'promotional', body: '', variable_defaults: {} },
  );
  const defaults = form.variable_defaults ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vars = useMemo(() => variablesOf(form.body), [form.body]);
  const sameDefaults = (a: Record<string, string>, b: Record<string, string>) =>
    vars.every((v) => (a[v] ?? '').trim() === (b[v] ?? '').trim());
  const dirty = !template || form.name !== template.name || form.category !== template.category || form.body !== template.body
    || !sameDefaults(defaults, template.variable_defaults ?? {});
  const valid = form.name.trim() && form.body.trim() && form.body.length <= MAX_LEN;
  const canSubmit = template && !dirty && (template.status === 'draft' || template.status === 'rejected');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<Template | null>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => (template ? api.updateTemplate(template.id, form) : api.createTemplate(form)));
  const submit = () => run(() => api.submitTemplate(template!.id));
  const remove = () => {
    if (confirm(`Delete "${template!.name}"? This can't be undone.`)) run(() => api.deleteTemplate(template!.id).then(() => null));
  };

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Inserts at the cursor. Name it after the Excel column that will fill it.
  const insertVar = () => {
    const raw = prompt('Variable name: use the column name from your Excel file, e.g. name or order_id')?.trim();
    const name = raw?.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) return;
    const el = bodyRef.current;
    const at = el ? el.selectionStart : form.body.length;
    setForm((f) => ({ ...f, body: `${f.body.slice(0, at)}{{${name}}}${f.body.slice(at)}` }));
  };

  return (
    <div className="overlay" onClick={onClose}>
      <section className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Template editor">
        <header className="drawer-head">
          <div>
            <h2>{template ? 'Edit template' : 'New template'}</h2>
            {template && <span className={`status st-${template.status}`}>{template.status}</span>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="drawer-body">
          <div className="form">
            {template?.status === 'approved' && dirty && (
              <div className="banner warn">Saving changes moves this template back to draft. It will need approval again.</div>
            )}
            {template?.status === 'rejected' && template.reject_reason && (
              <div className="banner error">Rejected: {template.reject_reason}</div>
            )}

            <label>
              Name
              <input className="input" value={form.name} maxLength={100} placeholder="e.g. diwali_offer_2026"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>

            <label>
              Category
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <span className="hint">{CATEGORIES.find((c) => c.value === form.category)?.hint}</span>
            </label>

            <label>
              <span className="row-between">
                Message
                <button type="button" className="link" onClick={insertVar}>+ Add variable</button>
              </span>
              <textarea ref={bodyRef} className="input" rows={7} value={form.body}
                placeholder={'Hi {{name}}, your order {{order_id}} is on the way. Track it here: {{link}}'}
                onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <span className={form.body.length > MAX_LEN ? 'hint bad' : 'hint'}>
                {form.body.length} / {MAX_LEN} characters. Use {'{{variable}}'} for personalised values.
              </span>
            </label>

            {vars.length > 0 && (
              <fieldset className="samples">
                <legend>Default values</legend>
                <p className="hint">
                  Values come from the list column with the same name (e.g. a <code>name</code> column in your Excel fills {'{{name}}'}).
                  The default is used when a contact's cell is empty. Leave it blank to skip those contacts instead.
                </p>
                {vars.map((v) => (
                  <label key={v} className="inline">
                    <code>{v}</code>
                    <input className="input" value={defaults[v] ?? ''} maxLength={200} placeholder={v === 'name' ? 'e.g. there' : 'Default value'}
                      onChange={(e) => setForm({ ...form, variable_defaults: { ...defaults, [v]: e.target.value } })} />
                  </label>
                ))}
              </fieldset>
            )}

            {error && <div className="banner error">{error}</div>}
          </div>

          <div className="preview">
            <div className="phone">
              <div className="phone-head">
                <span className="avatar">B</span>
                <div>
                  <div className="strong">Your Brand</div>
                  <div className="verified">Verified business</div>
                </div>
              </div>
              <div className="bubble">{form.body ? fill(form.body, defaults) : <span className="muted">Your message preview shows here</span>}</div>
            </div>
          </div>
        </div>

        <footer className="drawer-foot">
          {template && (
            <button className="btn danger-ghost" onClick={remove} disabled={busy}>Delete</button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={save} disabled={busy || !valid || !dirty}>
            {template ? 'Save changes' : 'Save as draft'}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !canSubmit}
            title={dirty ? 'Save your changes first' : undefined}>
            Submit for approval
          </button>
        </footer>
      </section>
    </div>
  );
}
