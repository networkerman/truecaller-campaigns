import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api, campaigns, lists, messages, senders, type ContactList, type SendersResponse, type Template } from './api';
import { AudiencePicker, audienceSource, emptyAudience, type Audience } from './Audience';
import { TcPhone, fmt, useAsync, usePoll } from './ui';

const VARS = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const STEPS = ['Audience', 'Message', 'Schedule', 'Check and send'] as const;

// Truecaller is the only channel today. Fallbacks are shown so customers know they are coming.
const CHANNELS = [
  { id: 'tc', title: 'Truecaller only', text: 'Verified business chat in Truecaller.', on: true },
  { id: 'tc-rcs', title: 'Truecaller, then RCS', text: 'RCS for people not reached on Truecaller.', on: false },
  { id: 'tc-wa', title: 'Truecaller, then WhatsApp', text: 'WhatsApp for people not reached on Truecaller.', on: false },
  { id: 'tc-sms', title: 'Truecaller, then SMS', text: 'An SMS for everyone else.', on: false },
];

// Full-page campaign creation: audience, message (sender, template, personalisation, test), schedule, review.
export function CampaignWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allLists, setLists] = useState<ContactList[]>([]);
  const [senderInfo, setSenderInfo] = useState<SendersResponse | null>(null);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<Audience>(emptyAudience);
  const [templateId, setTemplateId] = useState('');
  const [senderId, setSenderId] = useState('');
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [trackClicks, setTrackClicks] = useState(true);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [cohortSample, setCohortSample] = useState<Record<string, string>>({});
  const imported = useRef<{ from: Audience; listId: string } | null>(null);
  const { busy, error, run, setError } = useAsync();

  usePoll(() => {
    api.listTemplates().then(setTemplates);
    lists.all().then(setLists);
    senders.all().then(setSenderInfo, () => {});
  }, 0, false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = templates.find((x) => x.id === templateId);
  const approved = templates.filter((x) => x.status === 'approved');
  const activeSenders = senderInfo?.data.filter((x) => x.status === 'active') ?? [];
  const sender = activeSenders.find((x) => x.sender_id === senderId) ?? activeSenders[0];
  const senderLabel = sender ? sender.display_name : 'OneXtel';
  const senderValue = sender?.sender_id ?? senderInfo?.default_sender ?? '';

  const cohort = audience.mode === 'cohort' ? allLists.find((x) => x.id === audience.listId) : undefined;
  const recipients = cohort ? cohort.contact_count : audience.check?.valid ?? 0;
  const columns = cohort ? cohort.columns : audience.check?.attribute_columns ?? [];
  useEffect(() => {
    if (cohort) lists.get(cohort.id).then((l) => setCohortSample(l.sample[0]?.attributes ?? {}), () => setCohortSample({}));
  }, [cohort?.id]);
  const sample = cohort ? cohortSample : audience.check?.preview?.[0]?.attributes ?? {};

  const vars = t?.variables ?? [];
  const uncovered = vars.filter((v) => !columns.includes(v) && !defaults[v]?.trim());
  const fill = (text: string) => text.replace(VARS, (_, v: string) => String(sample[v] ?? '').trim() || defaults[v]?.trim() || `[${v}]`);
  const hasLink = !!t && (/https?:\/\//.test(t.body) || t.buttons?.some((b) => b.type === 'link'));
  const promo = t?.category === 'promotional';

  const stepOk = [
    name.trim().length > 0 && (cohort ? cohort.contact_count > 0 : recipients > 0),
    !!t && t.status === 'approved',
    when === 'now' || (!!at && new Date(at).getTime() > Date.now()),
    true,
  ];
  const ready = stepOk[0] && stepOk[1] && stepOk[2];

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    setDefaults({ ...(templates.find((x) => x.id === id)?.variable_defaults ?? {}) });
  };

  // A cohort is used as is. Any other source becomes a new contact list named after the campaign.
  const resolveList = async () => {
    if (cohort) return cohort.id;
    if (imported.current?.from === audience) return imported.current.listId;
    const list = await lists.create(`${name.trim()} · ${new Date().toLocaleString('en-IN')}`);
    await lists.importFrom(list.id, audienceSource(audience)!);
    imported.current = { from: audience, listId: list.id };
    return list.id;
  };

  const create = (launch: boolean) =>
    run(async () => {
      if (launch && when === 'later' && new Date(at).getTime() <= Date.now()) return setError('Pick a time in the future');
      if (launch && !confirm(when === 'now' ? `Send to ${fmt(recipients)} contacts now?` : `Schedule for ${new Date(at).toLocaleString()}?`)) return;
      const list_id = await resolveList();
      const c = await campaigns.create({
        name: name.trim(), template_id: templateId, list_id, sender_id: sender?.sender_id,
        variable_defaults: defaults, track_links: hasLink ? trackClicks : undefined,
      });
      if (launch) await campaigns.launch(c.id, when === 'later' ? new Date(at).toISOString() : undefined);
      onCreated(c.id);
    });

  const goto = (i: number) => {
    // Forward only through steps that are done; back is always allowed.
    if (i <= step || stepOk.slice(0, i).every(Boolean)) setStep(i);
  };

  return (
    <div className="wizard" role="dialog" aria-label="New campaign">
      <header className="wizard-head">
        <div>
          <h2>New campaign</h2>
          <span className="muted small">Campaigns · Truecaller</span>
        </div>
        <div className="row-gap center">
          <span className="muted small">Step {step + 1} of {STEPS.length}</span>
          <button className="btn" disabled={busy || !ready} onClick={() => create(false)} title={ready ? undefined : 'Finish the first three steps to save a draft'}>Save as draft</button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
      </header>

      <div className="wizard-body">
        <nav className="wizard-rail" aria-label="Steps">
          <ol className="wizard-steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i === step ? 'on' : i < step && stepOk[i] ? 'done' : ''}>
                <button onClick={() => goto(i)}>
                  <span className="wz-n">{i < step && stepOk[i] ? '✓' : i + 1}</span>
                  {s}
                </button>
              </li>
            ))}
          </ol>
          <div className="wizard-help">
            <b>Need help?</b>
            <span className="muted small">Your OneXtel account manager can take you through your first campaign.</span>
          </div>
        </nav>

        <main className="wizard-main">
          {step === 0 && (
            <section className="form">
              <h3 className="wz-title">Who should get it?</h3>
              <p className="muted">Name the campaign and choose the people to send it to.</p>
              <label>
                <span className="row-between">Campaign name <span className="hint">{name.length}/60</span></span>
                <input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali sale, wave 3" />
                <span className="hint">Only your team sees it.</span>
              </label>
              <AudiencePicker value={audience} onChange={setAudience} cohorts={allLists} variables={vars.filter((v) => !defaults[v]?.trim())} />
              <p className="hint">Opted-out numbers are always left out.</p>
            </section>
          )}

          {step === 1 && (
            <section className="form">
              <h3 className="wz-title">What should it say?</h3>
              <div>
                <div className="label">Send by</div>
                <div className="choice-grid two">
                  {CHANNELS.map((c) => (
                    <label key={c.id} className={`choice-card${c.on ? ' on' : ' disabled'}`} title={c.on ? undefined : 'Coming soon'}>
                      <input type="radio" name="channel" checked={c.on} disabled={!c.on} readOnly />
                      <span><span className="choice-title"><b>{c.title}</b>{!c.on && <span className="chip soon">Coming soon</span>}</span><span className="muted small">{c.text}</span></span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid-2 tight">
                <label>
                  Sender
                  {activeSenders.length ? (
                    <select className="input" value={sender?.sender_id ?? ''} onChange={(e) => setSenderId(e.target.value)}>
                      {activeSenders.map((x) => <option key={x.id} value={x.sender_id}>{x.display_name} ({x.sender_id})</option>)}
                    </select>
                  ) : (
                    <input className="input" disabled value={senderInfo ? `${senderInfo.default_sender} (platform default)` : ''} />
                  )}
                  <span className="hint">The verified profile people see. <a className="link" href="#/senders">Request another</a>.</span>
                </label>
                <label>
                  Template
                  <select className="input" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                    <option value="">Choose a template</option>
                    {approved.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.category}</option>)}
                  </select>
                  <span className="hint">{approved.length ? 'Only approved templates are listed.' : <>No approved templates yet. <a className="link" href="#/templates">Create one</a>.</>}</span>
                </label>
              </div>

              {t && vars.length > 0 && (
                <fieldset className="samples">
                  <legend>Personalisation</legend>
                  <p className="hint">Each {'{{variable}}'} is filled from the list column of the same name. The default is used when a cell is empty.</p>
                  {vars.map((v) => (
                    <label key={v} className="inline">
                      <code>{v}</code>
                      <input className="input" value={defaults[v] ?? ''} placeholder="Default value" onChange={(e) => setDefaults({ ...defaults, [v]: e.target.value })} />
                      <span className={columns.includes(v) ? 'hint ok' : 'hint bad'}>{columns.includes(v) ? 'Column found' : 'No column'}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {hasLink && (
                <label className="inline">
                  <input type="checkbox" checked={trackClicks} onChange={(e) => setTrackClicks(e.target.checked)} />
                  Track link clicks (links go through a short redirect so clicks show in reports)
                </label>
              )}
              {t && <TestSend templateId={t.id} senderId={sender?.sender_id} variables={Object.fromEntries(vars.map((v) => [v, String(sample[v] ?? '').trim() || defaults[v]?.trim() || '']))} />}
            </section>
          )}

          {step === 2 && (
            <section className="form">
              <h3 className="wz-title">When should it go out?</h3>
              <div className="choice-grid two">
                <label className={`choice-card${when === 'now' ? ' on' : ''}`}>
                  <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
                  <span><b>Now</b><span className="muted small">It starts as soon as you send it.</span></span>
                </label>
                <label className={`choice-card${when === 'later' ? ' on' : ''}`}>
                  <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />
                  <span><b>Later</b><span className="muted small">Pick a date and time.</span></span>
                </label>
              </div>
              {when === 'later' && (
                <label>
                  Date and time
                  <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                  {at && new Date(at).getTime() <= Date.now() && <span className="hint bad">Pick a time in the future.</span>}
                </label>
              )}
              {promo && <p className="hint">Promotional: contacts already sent 3 promo messages today, or 4 from this sender in 28 days, are skipped. A sender's daily limit pauses the campaign until the next day.</p>}
            </section>
          )}

          {step === 3 && (
            <section className="form">
              <h3 className="wz-title">Check and send</h3>
              <p className="muted">Once it starts sending you can stop it, but not change it.</p>
              <Review title="Audience" onChange={() => setStep(0)} rows={[
                ['Campaign', name], ['Contacts', `${fmt(recipients)}${cohort ? ` from ${cohort.name}` : ' from your upload'}`],
              ]} />
              <Review title="Message" onChange={() => setStep(1)} rows={[
                ['Send by', 'Truecaller only'], ['Sender', `${senderLabel} (${senderValue})`],
                ['Template', t ? `${t.name} · ${t.category}` : '—'], ['Click tracking', hasLink ? (trackClicks ? 'On' : 'Off') : 'No links'],
              ]} />
              <Review title="Schedule" onChange={() => setStep(2)} rows={[['Sends', when === 'now' ? 'Now' : new Date(at).toLocaleString()]]} />
              <div>
                <div className="label">Checks</div>
                <Check ok={!!t && t.status === 'approved'} title={`Template ${t?.name ?? ''} is approved`} />
                <Check ok title={`Sender ${senderValue} is active`} />
                <Check ok={uncovered.length === 0} title={uncovered.length ? `No value for ${uncovered.map((v) => `{{${v}}}`).join(', ')}` : 'Every variable has a column or a default'}
                  sub={uncovered.length ? 'Contacts without a value fail. Add a default on the Message step.' : undefined} />
                <Check ok title="Opted-out numbers are left out" />
              </div>
            </section>
          )}
          {error && <div className="banner error">{error}</div>}
        </main>

        <aside className="wizard-side">
          {step === 1 || step === 3 ? (
            <>
              <div className="label">Preview</div>
              <TcPhone sender={senderLabel} text={t ? fill(t.body) : ''} media={t?.media} buttons={t?.buttons?.map((b) => ({ ...b, text: fill(b.text) }))} />
              {Object.keys(sample).length > 0 && <p className="hint center">Shown with the first contact's values.</p>}
            </>
          ) : (
            <div className="card pad summary">
              <div className="label">Summary</div>
              <dl>
                <dt>Campaign</dt><dd>{name || 'Untitled campaign'}</dd>
                <dt>Reaches about</dt><dd>{recipients ? `${fmt(recipients)} people` : '—'}</dd>
                <dt>Channel</dt><dd>Truecaller</dd>
                <dt>Template</dt><dd>{t?.name ?? '—'}</dd>
                <dt>Sends</dt><dd>{when === 'now' ? 'Now' : at ? new Date(at).toLocaleString() : 'Later'}</dd>
              </dl>
            </div>
          )}
        </aside>
      </div>

      <footer className="wizard-foot">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        <div className="spacer" />
        {step < STEPS.length - 1 ? (
          <button className="btn primary" disabled={!stepOk[step]} onClick={() => setStep(step + 1)}>Next</button>
        ) : (
          <button className="btn primary" disabled={busy || !ready} onClick={() => create(true)}>
            {when === 'now' ? `Send to ${fmt(recipients)}` : 'Schedule'}
          </button>
        )}
      </footer>
    </div>
  );
}

function Review({ title, rows, onChange }: { title: string; rows: [string, string][]; onChange: () => void }) {
  return (
    <div className="review-card">
      <div className="row-between"><b>{title}</b><button className="link" onClick={onChange}>Change</button></div>
      <dl className="review">
        {rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
      </dl>
    </div>
  );
}

function Check({ ok, title, sub }: { ok: boolean; title: string; sub?: string }) {
  return (
    <div className="check-row">
      <span className={ok ? 'check ok' : 'check warn'}>{ok ? '✓' : '!'}</span>
      <div><div>{title}</div>{sub && <div className="hint">{sub}</div>}</div>
    </div>
  );
}

// Sends this template once to a number you type, filled with the first contact's values.
function TestSend({ templateId, senderId, variables }: { templateId: string; senderId?: string; variables: Record<string, string> }) {
  const [to, setTo] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  const filled = useMemo(() => Object.values(variables).every(Boolean), [variables]);
  return (
    <fieldset className="samples">
      <legend>Send a test <span className="hint">Optional</span></legend>
      <div className="row-gap">
        <input className="input" inputMode="tel" placeholder="Your number, e.g. 98xxxxxxxx" value={to} onChange={(e) => (setTo(e.target.value), setResult(null))} />
        <button type="button" className="btn" disabled={busy || to.replace(/\D/g, '').length < 10 || !filled}
          onClick={() => run(async () => {
            const m = await messages.send({ to, template_id: templateId, sender_id: senderId, variables });
            setResult(m.status === 'failed' ? `Failed: ${m.error ?? 'unknown error'}` : 'Sent. It should arrive in Truecaller in a few seconds.');
          })}>
          {busy ? 'Sending…' : 'Send test'}
        </button>
      </div>
      <span className="hint">{filled ? 'One real message to this number, with the first contact\'s values.' : 'Add defaults for every variable to send a test.'}</span>
      {result && <span className={result.startsWith('Failed') ? 'hint bad' : 'hint ok'}>{result}</span>}
      {error && <span className="hint bad">{error}</span>}
    </fieldset>
  );
}
