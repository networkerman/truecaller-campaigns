import type { Settings } from './settings.js';

// OnexAura (OneXtel Omni API) client for fallback sends and template lookups, using the customer's own
// OnexAura API key. RCS and WhatsApp go to /oapi/send_sms, plain SMS to /send_sms, as for the connectors.

export type FallbackChannel = 'rcs' | 'whatsapp' | 'sms';

export interface FallbackStep {
  channel: FallbackChannel;
  template: string; // RCS templateCode, WhatsApp template name, or our SMS template id
  language?: string; // WhatsApp only
  // Template parameter -> contact column, or "=text" for a fixed value. For WhatsApp the keys are 1, 2, 3...
  params: Record<string, string>;
}

export interface SmsTemplate {
  id: string;
  name: string;
  dlt_template_id: string;
  body: string;
}

const CATEGORY = { transactional: 'Transactional', service: 'Transactional', promotional: 'Promotional' } as const;

export function resolveParam(source: string, attrs: Record<string, string>) {
  if (source.startsWith('=')) return source.slice(1);
  return String(attrs[source] ?? attrs[source.toLowerCase()] ?? '').trim();
}

// The request for one fallback message. `to` is E.164 (+91...); OnexAura takes the digits with country code.
export function buildFallbackRequest(
  s: Settings,
  step: FallbackStep,
  to: string,
  attrs: Record<string, string>,
  category: keyof typeof CATEGORY,
  sms?: SmsTemplate,
) {
  const recipient = to.replace(/\D/g, '');
  const base = s.fallback.onexaura.base_url.replace(/\/$/, '');
  const values = Object.fromEntries(Object.entries(step.params).map(([k, v]) => [k, resolveParam(v, attrs)]));
  if (step.channel === 'rcs') {
    return {
      url: `${base}/oapi/send_sms`,
      body: {
        rcs: [{
          sender: s.fallback.rcs.bot_id,
          recipient,
          messageType: CATEGORY[category],
          contentMessage: { templateMessage: { templateCode: step.template, ...(Object.keys(values).length ? { customParams: JSON.stringify(values) } : {}) } },
        }],
      },
    };
  }
  if (step.channel === 'whatsapp') {
    const ordered = Object.keys(values).sort((a, b) => Number(a) - Number(b)).map((k) => ({ type: 'text', text: values[k] }));
    return {
      url: `${base}/oapi/send_sms`,
      body: {
        wa: [{
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          recipient: [recipient],
          sender: s.fallback.whatsapp.sender,
          type: 'template',
          template: {
            name: step.template,
            language: { code: step.language || 'en' },
            ...(ordered.length ? { components: [{ type: 'body', parameters: ordered }] } : {}),
          },
        }],
      },
    };
  }
  if (!sms) throw new Error('SMS template not found');
  const text = sms.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');
  return {
    url: `${base}/send_sms`,
    body: {
      sms: [{
        sender: s.fallback.sms.sender,
        recipient,
        type: s.fallback.sms.type,
        templateId: sms.dlt_template_id,
        entityId: s.fallback.sms.entity_id,
        messageBody: text,
      }],
    },
  };
}

// Reads the message id out of any of the Omni response shapes: RCS/WhatsApp return an array of
// { messageId, code, status }, SMS returns { smsList | smslist: { sms: [{ messageid, status: 200 }] } }.
export function parseSendResponse(httpStatus: number, json: unknown): { messageId: string } | { error: string } {
  const j = json as Record<string, unknown> | unknown[] | null;
  const first = Array.isArray(j)
    ? (j[0] as Record<string, unknown> | undefined)
    : (((j?.smsList ?? j?.smslist) as { sms?: Record<string, unknown>[] } | undefined)?.sms?.[0]);
  const id = first && (first.messageId ?? first.messageid);
  const code = first && Number(first.code ?? first.status);
  if (httpStatus < 300 && typeof id === 'string' && id && (code === 200 || code === 100 || Number.isNaN(code))) return { messageId: id };
  const why = first?.description ?? first?.reason ?? first?.status ?? (j as Record<string, unknown> | null)?.message ?? (j as Record<string, unknown> | null)?.error;
  return { error: `OnexAura ${httpStatus}: ${typeof why === 'string' ? why : JSON.stringify(json).slice(0, 200)}` };
}

export async function sendFallback(apiKey: string, req: { url: string; body: unknown }) {
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { apikey: apiKey, apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text.slice(0, 200) }; }
  return parseSendResponse(res.status, json);
}

// Templates for the fallback picker. Fetch needs the RCS bot id or the WhatsApp WABA id and returns
// only that account's templates. Shapes vary by build, so this reads names and text loosely.
export async function fetchTemplates(s: Settings, channel: 'rcs' | 'whatsapp') {
  const base = s.fallback.onexaura.base_url.replace(/\/$/, '');
  const body = channel === 'rcs'
    ? { channel: 'RCS', botId: s.fallback.rcs.bot_id, pageNo: '1', limit: '100' }
    : { channel: 'WhatsApp', wabaId: s.fallback.whatsapp.waba_id, pageNo: '1', limit: '100' };
  const res = await fetch(`${base}/oapi/templates/fetch`, {
    method: 'POST',
    headers: { apikey: s.fallback.onexaura.api_key, apiKey: s.fallback.onexaura.api_key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const list = findArray(json);
  if (!list) return { templates: [], message: typeof json.message === 'string' ? json.message : `OnexAura ${res.status}` };
  const templates = list.filter(Boolean).map((t) => normaliseTemplate(t as Record<string, unknown>, channel)).filter((t) => t.name);
  return { templates, message: null };
}

function findArray(j: unknown): unknown[] | null {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return null;
  for (const k of ['templates', 'data', 'result', 'rows', 'items']) {
    const v = (j as Record<string, unknown>)[k];
    const a = findArray(v);
    if (a) return a;
  }
  return null;
}

// Name, status, language and the parameter keys the body uses: [name] for RCS, {{1}} for WhatsApp.
function normaliseTemplate(t: Record<string, unknown>, channel: 'rcs' | 'whatsapp') {
  const name = String(t.templateName ?? t.template_name ?? t.name ?? t.templateCode ?? '');
  const raw = JSON.stringify(t);
  const params = channel === 'rcs'
    ? [...new Set([...raw.matchAll(/\[([a-zA-Z0-9_]+)\]/g)].map((m) => m[1]))]
    : [...new Set([...raw.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => Number(a) - Number(b));
  const lang = t.language as unknown;
  return {
    name,
    status: String(t.status ?? t.templateStatus ?? ''),
    language: typeof lang === 'string' ? lang : typeof (lang as { code?: string })?.code === 'string' ? (lang as { code: string }).code : '',
    params,
  };
}

// DLR/callback from OnexAura for a fallback message. Field names differ by channel and callback format,
// so look for the id and a status word in the common places.
export function parseOnexauraCallback(body: unknown): { providerMessageId: string; status: 'delivered' | 'read' | 'failed' | null; error?: string }[] {
  const items = Array.isArray(body) ? body : [body];
  const out: { providerMessageId: string; status: 'delivered' | 'read' | 'failed' | null; error?: string }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = [r.messageId, r.messageid, r.MSGID, r.msgId, r.sid, r.uuid, (r.entity as Record<string, unknown> | undefined)?.messageId]
      .find((v) => typeof v === 'string' && v) as string | undefined;
    if (!id) continue;
    const words = [r.status, r.STATUS, r.event, r.eventType, r.deliveryStatus, r.dlrStatus, r.reason].filter((v) => typeof v === 'string').join(' ').toUpperCase();
    const err = [r.errCode, r.errorCode, r.ERRORCODE].find((v) => v !== undefined && v !== null && v !== '');
    let status: 'delivered' | 'read' | 'failed' | null = null;
    if (/\bREAD\b/.test(words)) status = 'read';
    else if (/^DELIV|\bDELIVERED\b|\bDELIVRD\b|\bSUCCESS\b/.test(words) || String(err) === '000') status = 'delivered';
    else if (/FAIL|UNDELIV|REJECT|EXPIRED/.test(words) || (err !== undefined && String(err) !== '000' && String(err) !== '0')) status = 'failed';
    out.push({ providerMessageId: id, status, ...(status === 'failed' ? { error: String(r.error ?? r.ERRORDESP ?? r.errorDesc ?? err ?? words) } : {}) });
  }
  return out;
}
