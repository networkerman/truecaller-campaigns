import { useState } from 'react';
import { lists, type AudienceSource, type CheckResult, type ContactList } from './api';
import { fmt } from './ui';

export type AudienceMode = 'file' | 'sheet' | 'url' | 'cohort';

export interface Audience {
  mode: AudienceMode;
  file: File | null;
  url: string;
  listId: string;
  // Result of the last Validate Records run. Cleared whenever the input changes.
  check: CheckResult | null;
}

export const emptyAudience: Audience = { mode: 'file', file: null, url: '', listId: '', check: null };

export function audienceSource(a: Audience): AudienceSource | null {
  if (a.mode === 'file') return a.file ? { kind: 'file', file: a.file } : null;
  if (a.mode === 'sheet' || a.mode === 'url') return a.url.trim() ? { kind: a.mode, url: a.url.trim() } : null;
  return null;
}

const MODES: { mode: AudienceMode; label: string; info: string }[] = [
  { mode: 'file', label: 'File Upload', info: 'Upload a .csv or .xlsx file from your device.' },
  { mode: 'sheet', label: 'Google Sheet', info: 'Paste the link to a Google Sheet shared as "Anyone with the link". The first tab is used unless the link points to another tab.' },
  { mode: 'url', label: 'Public URL', info: 'Paste a direct link to a CSV file that opens without signing in.' },
  { mode: 'cohort', label: 'Cohort', info: 'Send to a contact list you have already saved.' },
];

const SHARED = [
  'The file size cannot exceed 50 MB',
  'Other column names become placeholders, in lower case with spaces as underscores (First Name → {{first_name}}). They must cover every placeholder in the template',
  'The link should NOT be shortened',
];

const REQUIREMENTS: Record<Exclude<AudienceMode, 'cohort'>, string[]> = {
  file: ['Only acceptable file types are .csv and .xlsx', ...SHARED.slice(0, 2), 'The file should contain this column:'],
  sheet: [
    'The link to the Google Sheet should be publicly accessible. Set General access to "Anyone with the link"',
    ...SHARED,
    'The Google Sheet should contain this column:',
  ],
  url: [
    'The remote file should be of type CSV',
    'The link to the file should be publicly accessible (no sign-in or access restrictions)',
    ...SHARED,
    'The CSV file should contain this column:',
  ],
};

export function AudiencePicker({ value, onChange, cohorts, variables }: {
  value: Audience;
  onChange: (a: Audience) => void;
  cohorts: ContactList[];
  variables: string[];
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const set = (patch: Partial<Audience>) => {
    setError(null);
    onChange({ ...value, check: null, ...patch });
  };

  const validate = async (a: Audience) => {
    const src = audienceSource(a);
    if (!src) return;
    setChecking(true);
    setError(null);
    try {
      onChange({ ...a, check: await lists.validate(src) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const pickFile = (file: File | null) => {
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setError('Only .csv and .xlsx files are accepted.');
    if (file.size > 50 * 1024 * 1024) return setError('The file is larger than 50 MB.');
    const next = { ...value, file, check: null };
    onChange(next);
    validate(next); // uploads are checked straight away, links wait for Validate Records
  };

  const mode = value.mode;
  const columns = mode === 'cohort' ? cohorts.find((c) => c.id === value.listId)?.columns ?? null : value.check?.attribute_columns ?? null;
  const missing = columns ? variables.filter((v) => !columns.includes(v)) : [];

  return (
    <div className="audience">
      <div className="label">Create a campaign using:</div>
      <div className="audience-modes" role="radiogroup">
        {MODES.map((m) => (
          <label key={m.mode} className="inline">
            <input type="radio" name="audience" checked={mode === m.mode} onChange={() => set({ mode: m.mode })} />
            {m.label}
            <span className="info" title={m.info} aria-hidden="true">i</span>
          </label>
        ))}
      </div>

      {mode === 'cohort' ? (
        <div className="audience-panel">
          <select className="input" value={value.listId} onChange={(e) => set({ listId: e.target.value })}>
            <option value="">Choose a saved contact list</option>
            {cohorts.map((x) => <option key={x.id} value={x.id}>{x.name} ({fmt(x.contact_count)} contacts)</option>)}
          </select>
          {cohorts.length === 0 && <p className="hint">No saved lists yet. Make one on the Contact lists page, or use another option.</p>}
        </div>
      ) : (
        <div
          className={`audience-panel${mode === 'file' ? ' drop' : ''}${dragging ? ' over' : ''}`}
          onDragOver={mode === 'file' ? (e) => (e.preventDefault(), setDragging(true)) : undefined}
          onDragLeave={() => setDragging(false)}
          onDrop={mode === 'file' ? (e) => (e.preventDefault(), setDragging(false), pickFile(e.dataTransfer.files[0] ?? null)) : undefined}
        >
          <div className="req-head">
            <h3>Requirements</h3>
            <a className="link" href="/sample-contacts.csv" download="sample-contacts.csv">⤓ Download sample file</a>
          </div>
          <ol className="req-list">
            {REQUIREMENTS[mode].map((r) => <li key={r}>{r}</li>)}
          </ol>
          <div className="req-column" title="Also accepted: mobile, msisdn, number, phone_number, mobile_number, truecaller, truecaller_number">PHONE</div>
          <p className="hint">The Truecaller mobile number. 10-digit numbers are treated as Indian (+91).</p>

          {mode === 'file' ? (
            <div className="req-action">
              <span className="muted">{value.file ? value.file.name : 'Drag and drop a file from your device here'}</span>
              <span className="muted">or</span>
              <label className="btn primary">
                ⤒ {value.file ? 'Choose another file' : 'Upload file'}
                <input type="file" hidden accept=".csv,.xlsx,text/csv" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          ) : (
            <div className="req-action link-row">
              <input
                className="input"
                value={value.url}
                placeholder={mode === 'sheet' ? 'Link to Google Sheet' : 'Link to CSV'}
                onChange={(e) => set({ url: e.target.value })}
              />
              <button type="button" className="btn primary" disabled={checking || !value.url.trim()} onClick={() => validate(value)}>
                {checking ? 'Checking…' : 'Validate records'}
              </button>
            </div>
          )}
          {checking && mode === 'file' && <p className="hint">Checking the file…</p>}
        </div>
      )}

      {error && <div className="banner error">{error}</div>}
      {value.check && <CheckSummary check={value.check} />}
      {missing.length > 0 && (
        <div className="banner warn">
          No column for {missing.map((m) => `{{${m}}}`).join(', ')}. Add a default below, or those contacts will fail with a missing value.
        </div>
      )}
    </div>
  );
}

function CheckSummary({ check }: { check: CheckResult }) {
  return (
    <div className={`banner ${check.valid ? 'ok' : 'error'}`}>
      <div>
        <b>{fmt(check.valid)}</b> valid {check.valid === 1 ? 'contact' : 'contacts'} out of {fmt(check.rows)} rows.
        {check.invalid > 0 && <> {fmt(check.invalid)} invalid {check.invalid === 1 ? 'number' : 'numbers'} will be skipped{check.invalid_samples.length > 0 && `, e.g. row ${check.invalid_samples.slice(0, 3).map((s) => `${s.row} (${s.value || 'empty'})`).join(', ')}`}.</>}
        {check.duplicates_in_file > 0 && <> {fmt(check.duplicates_in_file)} duplicates merged.</>}
      </div>
      <div className="small">
        Phone column: {check.phone_column}. Placeholders: {check.attribute_columns.length ? check.attribute_columns.map((c) => `{{${c}}}`).join(', ') : 'none'}.
      </div>
    </div>
  );
}
