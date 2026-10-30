import { useEffect, useMemo, useRef, useState } from 'react';
import { api, MEDIA_TYPES, type Button, type Category, type Media, type MediaType, type Template, type TemplateInput } from './api';
import { RichParts } from './ui';

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const MAX_LEN = 1000;
const CATEGORIES: { value: Category; label: string; hint: string }[] = [
  { value: 'promotional', label: 'Promotional', hint: 'Offers and marketing. Subject to tier limits and 4 sends per user every 28 days.' },
  { value: 'transactional', label: 'Transactional', hint: 'OTPs, order and payment updates.' },
  { value: 'service', label: 'Service', hint: 'Account notices, reminders and alerts.' },
];

const KIND_LABEL = (m: MediaType) => (m.startsWith('image/') ? 'Image' : m.startsWith('video/') ? 'Video' : 'File');
const typeOf = (t: Pick<Template, 'media' | 'buttons'>) =>
  [t.media && KIND_LABEL(t.media.mime_type), t.buttons?.length && `${t.buttons.length} button${t.buttons.length > 1 ? 's' : ''}`].filter(Boolean).join(' + ') || 'Text';
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
  const [layout, setLayoutState] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('templates.layout') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const setLayout = (l: 'grid' | 'list') => {
    setLayoutState(l);
    try { localStorage.setItem('templates.layout', l); } catch { /* private mode: keep it for this visit only */ }
  };
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
        <div className="tabs layout-toggle" role="group" aria-label="Layout">
          <button className={layout === 'grid' ? 'tab on' : 'tab'} onClick={() => setLayout('grid')} aria-pressed={layout === 'grid'} title="Grid">▦ Grid</button>
          <button className={layout === 'list' ? 'tab on' : 'tab'} onClick={() => setLayout('list')} aria-pressed={layout === 'list'} title="List">☰ List</button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className={layout === 'grid' && !loading && shown.length > 0 ? '' : 'card'}>
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
        ) : layout === 'grid' ? (
          <div className="template-grid">
            {shown.map((t) => (
              <button key={t.id} className="template-card" onClick={() => setEditing({ mode: 'edit', template: t })}>
                <TemplateThumb t={t} />
                <div className="template-card-body">
                  <div className="row-between">
                    <span className="strong clip">{t.name}</span>
                    <span className={`status st-${t.status}`}>{t.status}</span>
                  </div>
                  <div className="template-card-meta">
                    <span className={`chip cat-${t.category}`}>{t.category}</span>
                    <span className="chip">{typeOf(t)}</span>
                  </div>
                  <div className="muted small">
                    {t.variables.length ? `Variables: ${t.variables.join(', ')}` : 'No variables'} · {new Date(t.updated_at).toLocaleDateString()}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Type</th>
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
                  <td><span className="chip">{typeOf(t)}</span></td>
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
      ? { name: template.name, category: template.category, body: template.body, variable_defaults: { ...template.variable_defaults },
          media: template.media, buttons: template.buttons ?? [] }
      : { name: '', category: 'promotional', body: '', variable_defaults: {}, media: null, buttons: [] },
  );
  const defaults = form.variable_defaults ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buttons = form.buttons ?? [];
  // Button labels and URLs can be personalised too.
  const allText = [form.body, ...buttons.flatMap((b) => [b.text, b.type === 'link' ? b.url : ''])].join('\n');
  const vars = useMemo(() => variablesOf(allText), [allText]);
  const buttonsOk = buttons.every((b) => b.text.trim() && (b.type === 'reply' || /^(https:\/\/|[a-z][a-z0-9+.-]*:\/\/)\S+/i.test(b.url.trim()) || /^https:\/\/\S*\{\{/.test(b.url)));
  const sameDefaults = (a: Record<string, string>, b: Record<string, string>) =>
    vars.every((v) => (a[v] ?? '').trim() === (b[v] ?? '').trim());
  const dirty = !template || form.name !== template.name || form.category !== template.category || form.body !== template.body
    || !sameDefaults(defaults, template.variable_defaults ?? {})
    || JSON.stringify(form.media ?? null) !== JSON.stringify(template.media ?? null)
    || JSON.stringify(buttons) !== JSON.stringify(template.buttons ?? []);
  const valid = form.name.trim() && form.body.trim() && form.body.length <= MAX_LEN && buttonsOk;
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

            <MediaField media={form.media ?? null} onChange={(media) => setForm((f) => ({ ...f, media }))} />
            <ButtonsField buttons={buttons} onChange={(buttons) => setForm((f) => ({ ...f, buttons }))} />

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
              <div className="bubble">
                {form.body ? fill(form.body, defaults) : <span className="muted">Your message preview shows here</span>}
                <RichParts media={form.media} buttons={buttons} fill={(t) => fill(t, defaults)} />
              </div>
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

// Top of a grid card: the image when there is one, otherwise the message as a chat bubble.
function TemplateThumb({ t }: { t: Template }) {
  const image = t.media?.mime_type.startsWith('image/') ? t.media.url : null;
  return (
    <div className={`template-thumb${image ? ' has-image' : ''}`}>
      {image ? (
        <img src={image} alt="" loading="lazy" />
      ) : (
        <div className="thumb-bubble">
          {t.media && <div className="rich-file small">{t.media.mime_type.startsWith('video/') ? '▶ Video' : `📄 ${t.media.file_name || 'File'}`}</div>}
          <div className="thumb-text">{t.body}</div>
          {t.buttons?.length > 0 && <div className="thumb-buttons">{t.buttons.map((b, i) => <span key={i}>{b.text}</span>)}</div>}
        </div>
      )}
    </div>
  );
}

// One optional attachment: upload a file (we host it) or paste a public https link.
function MediaField({ media, onChange }: { media: Media | null; onChange: (m: Media | null) => void }) {
  const [mode, setMode] = useState<'none' | 'upload' | 'link'>(media ? 'link' : 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!MEDIA_TYPES.includes(file.type as MediaType)) return setError('Use a JPEG, PNG or GIF image, an MP4 or MOV video, or a PDF or text file.');
    if (file.size > 20 * 1024 * 1024) return setError('Files can be up to 20 MB.');
    setBusy(true);
    try {
      const m = await api.uploadMedia(file);
      onChange({ url: m.url, mime_type: m.mime_type, file_name: m.file_name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="samples">
      <legend>Media <span className="hint">Optional</span></legend>
      <div className="tabs small">
        {(['none', 'upload', 'link'] as const).map((m) => (
          <button key={m} type="button" className={mode === m ? 'tab on' : 'tab'} onClick={() => (setMode(m), m === 'none' && onChange(null))}>
            {m === 'none' ? 'None' : m === 'upload' ? 'Upload file' : 'Use a link'}
          </button>
        ))}
      </div>
      {mode === 'upload' && (
        <label className="file-pick">
          <input type="file" accept={MEDIA_TYPES.join(',')} onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
          <span className="hint">{busy ? 'Uploading…' : 'Image (JPEG, PNG, GIF), video (MP4, MOV) or file (PDF, TXT), up to 20 MB.'}</span>
        </label>
      )}
      {mode === 'link' && (
        <>
          <input className="input" placeholder="https://… public link to the file" value={media?.url ?? ''}
            onChange={(e) => onChange({ url: e.target.value.trim(), mime_type: media?.mime_type ?? 'image/jpeg', file_name: media?.file_name })} />
          <select className="input" value={media?.mime_type ?? 'image/jpeg'} onChange={(e) => onChange({ url: media?.url ?? '', mime_type: e.target.value as MediaType, file_name: media?.file_name })}>
            {MEDIA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </>
      )}
      {media && (media.mime_type === 'application/pdf' || media.mime_type === 'text/plain') && (
        <label>
          File name people see
          <input className="input" value={media.file_name ?? ''} placeholder="e.g. invoice.pdf" onChange={(e) => onChange({ ...media, file_name: e.target.value })} />
        </label>
      )}
      {media && mode !== 'none' && <span className="hint">Attached: {media.file_name || media.url}</span>}
      {error && <span className="hint bad">{error}</span>}
    </fieldset>
  );
}

// Up to 3 buttons: link buttons open a page or app; quick replies send their text back as the person's reply.
function ButtonsField({ buttons, onChange }: { buttons: Button[]; onChange: (b: Button[]) => void }) {
  const set = (i: number, b: Button) => onChange(buttons.map((x, j) => (j === i ? b : x)));
  return (
    <fieldset className="samples">
      <legend>Buttons <span className="hint">Optional, up to 3</span></legend>
      {buttons.map((b, i) => (
        <div key={i} className="button-row">
          <select className="input" value={b.type} onChange={(e) => set(i, e.target.value === 'link' ? { type: 'link', text: b.text, url: '' } : { type: 'reply', text: b.text })}>
            <option value="link">Link</option>
            <option value="reply">Quick reply</option>
          </select>
          <input className="input" value={b.text} maxLength={b.type === 'link' ? 40 : 100} placeholder={b.type === 'link' ? 'Button text, e.g. Track order' : 'Reply text, e.g. Call me back'}
            onChange={(e) => set(i, { ...b, text: e.target.value })} />
          {b.type === 'link' && (
            <input className="input" value={b.url} placeholder="https://… (can use {{variables}})" onChange={(e) => set(i, { ...b, url: e.target.value })} />
          )}
          <button type="button" className="icon-btn" aria-label="Remove button" onClick={() => onChange(buttons.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {buttons.length < 3 && (
        <div className="row-gap">
          <button type="button" className="btn small" onClick={() => onChange([...buttons, { type: 'link', text: '', url: '' }])}>+ Link button</button>
          <button type="button" className="btn small" onClick={() => onChange([...buttons, { type: 'reply', text: '' }])}>+ Quick reply</button>
        </div>
      )}
      <span className="hint">Taps are counted in reports. Link buttons need https (or an app link).</span>
    </fieldset>
  );
}
