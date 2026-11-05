import { useEffect, useState } from 'react';
import { settingsApi, type FallbackChannel, type FallbackStep, type FallbackTemplate, type Settings, type SmsTemplate } from './api';

const LABEL: Record<FallbackChannel, string> = { rcs: 'RCS', whatsapp: 'WhatsApp', sms: 'SMS' };
const CHOICES: { id: 'tc' | FallbackChannel; title: string; text: string }[] = [
  { id: 'tc', title: 'Truecaller only', text: 'Verified business chat in Truecaller.' },
  { id: 'rcs', title: 'Truecaller, then RCS', text: 'RCS for people Truecaller does not reach.' },
  { id: 'whatsapp', title: 'Truecaller, then WhatsApp', text: 'WhatsApp for people Truecaller does not reach.' },
  { id: 'sms', title: 'Truecaller, then SMS', text: 'An SMS for everyone Truecaller does not reach.' },
];

const blankStep = (channel: FallbackChannel): FallbackStep => ({ channel, template: '', params: {} });

// Every step has a template and every template parameter is mapped to a column or a fixed value.
export function fallbackComplete(chain: FallbackStep[], paramsOf: Record<string, string[]>) {
  return chain.every((s) => s.template && (paramsOf[`${s.channel}:${s.template}`] ?? Object.keys(s.params)).every((p) => (s.params[p] ?? '').replace(/^=/, '').trim()));
}

// "Send by" for a campaign: Truecaller alone, or Truecaller then RCS, WhatsApp or SMS (and SMS after
// RCS or WhatsApp). Channels not set up in Settings are shown but disabled.
export function FallbackPicker({ settings, columns, value, onChange, onParams }: {
  settings: Settings | null;
  columns: string[];
  value: FallbackStep[];
  onChange: (chain: FallbackStep[]) => void;
  onParams: (key: string, params: string[]) => void;
}) {
  const ready = (c: FallbackChannel) => Boolean(settings?.fallback.onexaura.api_key_set && settings.fallback[c].enabled);
  const choice = value[0]?.channel ?? 'tc';
  const smsAfter = value[1]?.channel === 'sms';

  const pick = (id: 'tc' | FallbackChannel) => {
    if (id === 'tc') return onChange([]);
    const first = value.find((s) => s.channel === id) ?? blankStep(id);
    const sms = value.find((s) => s.channel === 'sms') ?? blankStep('sms');
    onChange(id !== 'sms' && smsAfter && ready('sms') ? [first, sms] : [first]);
  };
  const setStep = (i: number, s: FallbackStep) => onChange(value.map((x, j) => (j === i ? s : x)));

  return (
    <div className="fallback-picker">
      <div className="label">Send by</div>
      <div className="choice-grid two">
        {CHOICES.map((c) => {
          const on = c.id === 'tc' || ready(c.id);
          return (
            <label key={c.id} className={`choice-card${choice === c.id ? ' on' : ''}${on ? '' : ' disabled'}`} title={on ? undefined : 'Set this channel up in Settings first'}>
              <input type="radio" name="channel" checked={choice === c.id} disabled={!on} onChange={() => pick(c.id)} />
              <span>
                <span className="choice-title"><b>{c.title}</b>{!on && <span className="chip soon">Set up in Settings</span>}</span>
                <span className="muted small">{c.text}</span>
              </span>
            </label>
          );
        })}
      </div>
      {(choice === 'rcs' || choice === 'whatsapp') && ready('sms') && (
        <label className="inline">
          <input type="checkbox" checked={smsAfter}
            onChange={(e) => onChange(e.target.checked ? [value[0], value.find((s) => s.channel === 'sms') ?? blankStep('sms')] : [value[0]])} />
          If {LABEL[choice]} also fails, send an SMS
        </label>
      )}
      {value.length > 0 && <p className="hint">Fallback starts when Truecaller can't deliver (for example the number isn't on Truecaller) or the message expires without a delivery report.</p>}
      {value.map((s, i) => (
        <StepEditor key={s.channel} index={i} step={s} columns={columns} onChange={(n) => setStep(i, n)} onParams={onParams} />
      ))}
    </div>
  );
}

function StepEditor({ index, step, columns, onChange, onParams }: {
  index: number;
  step: FallbackStep;
  columns: string[];
  onChange: (s: FallbackStep) => void;
  onParams: (key: string, params: string[]) => void;
}) {
  const [remote, setRemote] = useState<FallbackTemplate[] | null>(null);
  const [sms, setSms] = useState<SmsTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (step.channel === 'sms') settingsApi.smsTemplates().then(setSms, (e) => setLoadError(e.message));
    else settingsApi.fallbackTemplates(step.channel).then((r) => (setRemote(r.templates), r.templates.length ? null : setLoadError(r.message ?? 'No templates found')), (e) => setLoadError(e.message));
  }, [step.channel]);

  const known = step.channel === 'sms'
    ? sms?.find((t) => t.id === step.template)?.variables
    : remote?.find((t) => t.name === step.template)?.params;
  const params = known ?? manual.split(',').map((p) => p.trim()).filter(Boolean);
  useEffect(() => { if (step.template) onParams(`${step.channel}:${step.template}`, params); }, [step.template, params.join(',')]);

  const setTemplate = (name: string) => {
    const tpl = remote?.find((t) => t.name === name);
    onChange({ ...step, template: name, language: tpl?.language || step.language, params: {} });
  };

  return (
    <fieldset className="samples">
      <legend>{index + 1}. {LABEL[step.channel]} fallback</legend>
      <div className="grid-2 tight">
        <label>{step.channel === 'sms' ? 'SMS template' : 'Template'}
          {step.channel === 'sms' ? (
            <select className="input" value={step.template} onChange={(e) => onChange({ ...step, template: e.target.value, params: {} })}>
              <option value="">Choose an SMS template</option>
              {sms?.map((t) => <option key={t.id} value={t.id}>{t.name} · DLT {t.dlt_template_id}</option>)}
            </select>
          ) : (
            <>
              <input className="input" list={`tpl-${step.channel}`} value={step.template} onChange={(e) => setTemplate(e.target.value)} placeholder={remote ? 'Pick or type a template name' : 'Loading templates…'} />
              <datalist id={`tpl-${step.channel}`}>{remote?.map((t) => <option key={t.name} value={t.name}>{t.status}</option>)}</datalist>
            </>
          )}
          {loadError && <span className="hint bad">{loadError}</span>}
          {step.channel === 'sms' && sms?.length === 0 && <span className="hint">Add SMS templates in Settings first.</span>}
        </label>
        {step.channel === 'whatsapp' && (
          <label>Language<input className="input" value={step.language ?? ''} onChange={(e) => onChange({ ...step, language: e.target.value })} placeholder="e.g. en, en_US" /></label>
        )}
      </div>
      {step.template && !known && step.channel !== 'sms' && (
        <label>Template parameters
          <input className="input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={step.channel === 'rcs' ? 'e.g. custom_param1, custom_param2' : 'e.g. 1, 2, 3'} />
          <span className="hint">This template wasn't in the list, so name its parameters, separated by commas. Leave empty if it has none.</span>
        </label>
      )}
      {params.map((p) => {
        const v = step.params[p] ?? '';
        const fixed = v.startsWith('=');
        return (
          <div key={p} className="param-row">
            <code>{step.channel === 'whatsapp' ? `{{${p}}}` : step.channel === 'rcs' ? `[${p}]` : `{{${p}}}`}</code>
            <select className="input" value={fixed ? '=' : v} onChange={(e) => onChange({ ...step, params: { ...step.params, [p]: e.target.value === '=' ? '=' : e.target.value } })}>
              <option value="">Choose a column</option>
              {columns.map((c) => <option key={c} value={c}>Column: {c}</option>)}
              <option value="=">Fixed value…</option>
            </select>
            {fixed && <input className="input" value={v.slice(1)} placeholder="Value" onChange={(e) => onChange({ ...step, params: { ...step.params, [p]: `=${e.target.value}` } })} />}
          </div>
        );
      })}
    </fieldset>
  );
}
