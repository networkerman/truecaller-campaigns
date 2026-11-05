import { useState } from 'react';
import { settingsApi, type Category, type FallbackTemplate, type Settings, type SmsTemplate } from './api';
import { PageHead, useAsync, usePoll } from './ui';

const VARS = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// Workspace settings: send window, frequency cap, message defaults, and the fallback channels that
// campaigns can use when Truecaller does not deliver (sent through the customer's OnexAura account).
export function SettingsPage({ canEdit }: { canEdit: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAsync();
  usePoll(() => void settingsApi.get().then(setS), 0, false);

  if (!s) return <><PageHead title="Settings" sub="Sending rules, defaults and fallback channels for this workspace." /><div className="card"><p className="empty">Loading…</p></div></>;

  const set = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => (setSaved(false), setS({ ...s, [k]: { ...s[k], ...v } }));
  const setFb = <K extends keyof Settings['fallback']>(k: K, v: Partial<Settings['fallback'][K]>) =>
    (setSaved(false), setS({ ...s, fallback: { ...s.fallback, [k]: { ...s.fallback[k], ...v } } }));
  const save = () => run(async () => {
    const next = await settingsApi.save({ ...s, fallback: { ...s.fallback, onexaura: { base_url: s.fallback.onexaura.base_url, api_key: apiKey } } });
    setS(next);
    setApiKey('');
    setSaved(true);
  });
  const ox = s.fallback.onexaura;
  const dis = !canEdit;

  return (
    <>
      <PageHead
        title="Settings"
        sub="Sending rules, defaults and fallback channels for this workspace."
        action={canEdit && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>}
      />
      {!canEdit && <div className="banner info-note">Only owners and admins can change settings.</div>}
      {error && <div className="banner error">{error}</div>}
      {saved && <div className="banner ok-note">Settings saved.</div>}

      <div className="settings-grid">
        <section className="card pad">
          <div className="row-between"><h3>Send window</h3><Toggle on={s.window.enabled} disabled={dis} onChange={(v) => set('window', { enabled: v })} /></div>
          <p className="hint">Campaigns only send between these times (India time).</p>
          <div className="grid-2 tight">
            <label>Start<input className="input" type="time" disabled={dis || !s.window.enabled} value={s.window.start} onChange={(e) => set('window', { start: e.target.value })} /></label>
            <label>End<input className="input" type="time" disabled={dis || !s.window.enabled} value={s.window.end} onChange={(e) => set('window', { end: e.target.value })} /></label>
          </div>
          <label>When the window closes
            <select className="input" disabled={dis || !s.window.enabled} value={s.window.after} onChange={(e) => set('window', { after: e.target.value as 'pause' | 'stop' })}>
              <option value="pause">Pause and continue in the next window</option>
              <option value="stop">Stop the campaign; unsent contacts are skipped</option>
            </select>
          </label>
        </section>

        <section className="card pad">
          <div className="row-between"><h3>Frequency cap</h3><Toggle on={s.frequency.enabled} disabled={dis} onChange={(v) => set('frequency', { enabled: v })} /></div>
          <p className="hint">The most campaign messages one person gets from this workspace. Truecaller's own promotional limits always apply too.</p>
          <div className="grid-2 tight">
            <label>Messages<input className="input" type="number" min={1} disabled={dis || !s.frequency.enabled} value={s.frequency.count} onChange={(e) => set('frequency', { count: Number(e.target.value) })} /></label>
            <label>In days<input className="input" type="number" min={1} disabled={dis || !s.frequency.enabled} value={s.frequency.days} onChange={(e) => set('frequency', { days: Number(e.target.value) })} /></label>
          </div>
          <label>Counts
            <select className="input" disabled={dis || !s.frequency.enabled} value={s.frequency.scope} onChange={(e) => set('frequency', { scope: e.target.value as 'all' | 'promotional' })}>
              <option value="all">All campaign messages</option>
              <option value="promotional">Promotional messages only</option>
            </select>
          </label>
        </section>

        <section className="card pad">
          <h3>Message defaults</h3>
          <label>Default message type for API sends
            <select className="input" disabled={dis} value={s.defaults.category} onChange={(e) => set('defaults', { category: e.target.value as Category })}>
              <option value="transactional">Transactional</option><option value="service">Service</option><option value="promotional">Promotional</option>
            </select>
          </label>
          <label>Message expiry (hours)
            <input className="input" type="number" min={1} max={672} disabled={dis} value={s.defaults.ttl_hours} onChange={(e) => set('defaults', { ttl_hours: Number(e.target.value) })} />
            <span className="hint">If Truecaller hasn't delivered a message by then, it is marked Expired and its fallback starts.</span>
          </label>
        </section>
      </div>

      <section className="card pad section">
        <h3>Fallback channels</h3>
        <p className="muted small">When a campaign message fails on Truecaller or expires undelivered, the campaign can send it on RCS, WhatsApp or SMS through your OnexAura account. Fallback is for campaigns only, not the API.</p>

        <div className="fb-block">
          <h4>OnexAura account</h4>
          <div className="grid-2 tight">
            <label>OnexAura API key
              <input className="input" type="password" autoComplete="off" disabled={dis} value={apiKey} onChange={(e) => (setSaved(false), setApiKey(e.target.value))}
                placeholder={ox.api_key_set ? `Saved, ends ${ox.api_key_last4}. Type to replace.` : 'Your OnexAura API key'} />
            </label>
            <label>API host
              <input className="input" disabled={dis} value={ox.base_url} onChange={(e) => setFb('onexaura', { base_url: e.target.value })} />
            </label>
          </div>
          {ox.callback_url ? (
            <div className="callout">
              <b>Delivery reports for fallback messages</b>
              <span className="small">In OnexAura, under <b>Configuration → Add New Callback</b>, add this URL for the RCS, WhatsApp and SMS channels you use here, with this API key:</span>
              <code className="copy-line">{ox.callback_url}</code>
            </div>
          ) : <p className="hint">Save once to get the callback URL for fallback delivery reports.</p>}
        </div>

        <div className="fb-block">
          <div className="row-between"><h4>RCS</h4><Toggle on={s.fallback.rcs.enabled} disabled={dis} onChange={(v) => setFb('rcs', { enabled: v })} /></div>
          <label>RCS bot ID
            <input className="input" disabled={dis || !s.fallback.rcs.enabled} value={s.fallback.rcs.bot_id} onChange={(e) => setFb('rcs', { bot_id: e.target.value })} placeholder="e.g. 6aaa9e6e734aa52ea9677163" />
            <span className="hint">Needed to list your RCS templates. Find it in your OnexAura RCS sender profile.</span>
          </label>
          {s.fallback.rcs.enabled && <TemplateCheck channel="rcs" ready={Boolean(ox.api_key_set && s.fallback.rcs.bot_id)} />}
        </div>

        <div className="fb-block">
          <div className="row-between"><h4>WhatsApp</h4><Toggle on={s.fallback.whatsapp.enabled} disabled={dis} onChange={(v) => setFb('whatsapp', { enabled: v })} /></div>
          <div className="grid-2 tight">
            <label>WABA ID<input className="input" disabled={dis || !s.fallback.whatsapp.enabled} value={s.fallback.whatsapp.waba_id} onChange={(e) => setFb('whatsapp', { waba_id: e.target.value })} placeholder="WhatsApp Business Account ID" /></label>
            <label>WhatsApp number<input className="input" disabled={dis || !s.fallback.whatsapp.enabled} value={s.fallback.whatsapp.sender} onChange={(e) => setFb('whatsapp', { sender: e.target.value })} placeholder="e.g. 919777777777" /></label>
          </div>
          {s.fallback.whatsapp.enabled && <TemplateCheck channel="whatsapp" ready={Boolean(ox.api_key_set && s.fallback.whatsapp.waba_id)} />}
        </div>

        <div className="fb-block">
          <div className="row-between"><h4>SMS</h4><Toggle on={s.fallback.sms.enabled} disabled={dis} onChange={(v) => setFb('sms', { enabled: v })} /></div>
          <div className="grid-3">
            <label>Sender ID (header)<input className="input" disabled={dis || !s.fallback.sms.enabled} value={s.fallback.sms.sender} onChange={(e) => setFb('sms', { sender: e.target.value })} placeholder="e.g. ONEXTL" /></label>
            <label>DLT entity ID<input className="input" disabled={dis || !s.fallback.sms.enabled} value={s.fallback.sms.entity_id} onChange={(e) => setFb('sms', { entity_id: e.target.value })} /></label>
            <label>SMS type
              <select className="input" disabled={dis || !s.fallback.sms.enabled} value={s.fallback.sms.type} onChange={(e) => setFb('sms', { type: e.target.value as Settings['fallback']['sms']['type'] })}>
                <option value="SI">Service implicit (SI)</option><option value="SE">Service explicit (SE)</option><option value="Trans">Transactional</option><option value="OTP">OTP</option>
              </select>
            </label>
          </div>
          {s.fallback.sms.enabled && <SmsTemplates canEdit={canEdit} />}
        </div>
      </section>
    </>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className={on ? 'toggle-switch on' : 'toggle-switch'} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

// Lists templates from OnexAura to confirm the key and ID work.
function TemplateCheck({ channel, ready }: { channel: 'rcs' | 'whatsapp'; ready: boolean }) {
  const [list, setList] = useState<FallbackTemplate[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  return (
    <div className="tpl-check">
      <button type="button" className="btn small" disabled={busy || !ready} title={ready ? undefined : 'Save the API key and ID first'}
        onClick={() => run(async () => { const r = await settingsApi.fallbackTemplates(channel); setList(r.templates); setMsg(r.message); })}>
        {busy ? 'Checking…' : 'Check templates'}
      </button>
      {error && <span className="hint bad">{error}</span>}
      {list && (list.length ? <span className="hint ok">{list.length} templates found, e.g. {list.slice(0, 3).map((t) => t.name).join(', ')}</span> : <span className="hint bad">{msg ?? 'No templates found.'}</span>)}
    </div>
  );
}

// SMS has no template fetch in OnexAura, so DLT templates are added here.
function SmsTemplates({ canEdit }: { canEdit: boolean }) {
  const [list, setList] = useState<SmsTemplate[]>([]);
  const [f, setF] = useState({ name: '', dlt_template_id: '', body: '' });
  const { busy, error, run } = useAsync();
  const load = () => settingsApi.smsTemplates().then(setList);
  usePoll(() => void load(), 0, false);
  const vars = [...new Set([...f.body.matchAll(VARS)].map((m) => m[1]))];
  return (
    <div className="sms-templates">
      <div className="label">SMS templates</div>
      {list.length === 0 ? <p className="hint">No SMS templates yet. Add the DLT-approved text you want to use as fallback.</p> : (
        <table className="table compact">
          <thead><tr><th>Name</th><th>DLT template ID</th><th>Text</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="static">
                <td className="strong">{t.name}</td><td><code>{t.dlt_template_id}</code></td><td className="small">{t.body}</td>
                {canEdit && <td className="num"><button className="btn danger-ghost small" disabled={busy} onClick={() => confirm(`Delete "${t.name}"?`) && run(() => settingsApi.removeSmsTemplate(t.id).then(load))}>Delete</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="sms-add">
          <div className="grid-2 tight">
            <label>Name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Order update" /></label>
            <label>DLT template ID<input className="input" inputMode="numeric" value={f.dlt_template_id} onChange={(e) => setF({ ...f, dlt_template_id: e.target.value.trim() })} placeholder="1107…" /></label>
          </div>
          <label>Text, exactly as registered on DLT
            <textarea className="input" rows={2} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Hi {{name}}, your order {{order_id}} has shipped. -ONEXTL" />
            <span className="hint">Use {'{{variable}}'} where DLT has a variable; campaigns map each one to a list column.{vars.length > 0 && ` Variables: ${vars.join(', ')}.`}</span>
          </label>
          <button className="btn small" disabled={busy || !f.name.trim() || !f.dlt_template_id || !f.body.trim()}
            onClick={() => run(() => settingsApi.addSmsTemplate(f).then(() => (setF({ name: '', dlt_template_id: '', body: '' }), load())))}>Add SMS template</button>
          {error && <span className="hint bad">{error}</span>}
        </div>
      )}
    </div>
  );
}
