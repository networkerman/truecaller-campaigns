// The dashboard holds no key of its own: the user signs in with an API key, kept in this browser only.
const KEY_STORE = 'tc_api_key';
const readStored = () => {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
};
let apiKey: string | null = readStored();
let onUnauthorized: () => void = () => {};

export const session = {
  signedIn: () => Boolean(apiKey),
  set(key: string) {
    apiKey = key;
    try {
      localStorage.setItem(KEY_STORE, key);
    } catch {
      /* private mode: the key lasts for this page only */
    }
  },
  clear() {
    apiKey = null;
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* ignore */
    }
  },
  onUnauthorized: (fn: () => void) => (onUnauthorized = fn),
};

// Every request goes through here so an expired or revoked key sends the user back to sign-in.
async function request(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { ...init.headers, 'x-api-key': apiKey ?? '' } });
  if (res.status === 401) {
    session.clear();
    onUnauthorized();
  }
  return res;
}

export async function checkKey(key: string) {
  const res = await fetch('/v1/templates', { headers: { 'x-api-key': key } });
  return res.ok;
}

export type Category = 'promotional' | 'transactional' | 'service';
export type TemplateStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Template {
  id: string;
  name: string;
  category: Category;
  body: string;
  variables: string[];
  status: TemplateStatus;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type TemplateInput = Pick<Template, 'name' | 'category' | 'body'>;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  listTemplates: () => call<{ data: Template[] }>('GET', '/v1/templates').then((r) => r.data),
  createTemplate: (t: TemplateInput) => call<Template>('POST', '/v1/templates', t),
  updateTemplate: (id: string, t: TemplateInput) => call<Template>('PUT', `/v1/templates/${id}`, t),
  deleteTemplate: (id: string) => call<void>('DELETE', `/v1/templates/${id}`),
  submitTemplate: (id: string) => call<Template>('POST', `/v1/templates/${id}/submit`),
};

export interface ContactList {
  id: string;
  name: string;
  columns: string[];
  contact_count: number;
  created_at: string;
}

export interface ListDetail extends ContactList {
  sample: { phone: string; attributes: Record<string, string>; opted_out: boolean }[];
}

export interface UploadResult {
  rows: number;
  added: number;
  updated: number;
  duplicates_in_file: number;
  invalid: number;
  invalid_samples: { row: number; value: string }[];
  phone_column: string;
  attribute_columns: string[];
}

export interface CheckResult extends Omit<UploadResult, 'added' | 'updated'> {
  valid: number;
  preview: { phone: string; attributes: Record<string, string> }[];
}

// Where a campaign audience comes from. A link is fetched by the server, so it must be public.
export type AudienceSource = { kind: 'file'; file: File } | { kind: 'sheet' | 'url'; url: string };

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  template_id: string;
  template_name: string;
  template_body: string;
  template_status: string;
  category: Category;
  list_id: string;
  list_name: string;
  sender_id: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  note: string | null;
  created_at: string;
  recipients: number;
  processed: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  blocked: number;
  queued: number;
}

export interface Report {
  campaign: Campaign;
  funnel: { stage: string; count: number }[];
  rates: { delivery_rate: number; read_rate: number; failure_rate: number; blocked_rate: number };
  reasons: { status: 'failed' | 'blocked'; reason: string; count: number }[];
  timeline: { minute: string; processed: number }[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  key?: string;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const isXlsx = (file: File) => /\.xlsx$/i.test(file.name);

async function upload<T>(path: string, file: File): Promise<T> {
  const res = await request(path, { method: 'POST', headers: { 'content-type': isXlsx(file) ? XLSX_TYPE : 'text/csv' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data as T;
}

export async function downloadCsv(path: string, filename: string) {
  const res = await request(path);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const lists = {
  all: () => call<{ data: ContactList[] }>('GET', '/v1/lists').then((r) => r.data),
  get: (id: string) => call<ListDetail>('GET', `/v1/lists/${id}`),
  create: (name: string) => call<ContactList>('POST', '/v1/lists', { name }),
  remove: (id: string) => call<void>('DELETE', `/v1/lists/${id}`),
  upload: (id: string, file: File) => upload<UploadResult>(`/v1/lists/${id}/contacts`, file),
  validate: (src: AudienceSource) =>
    src.kind === 'file'
      ? upload<CheckResult>('/v1/lists/validate', src.file)
      : call<CheckResult>('POST', '/v1/lists/validate', { source: src.kind, url: src.url }),
  importFrom: (id: string, src: AudienceSource) =>
    src.kind === 'file'
      ? upload<UploadResult>(`/v1/lists/${id}/contacts`, src.file)
      : call<UploadResult>('POST', `/v1/lists/${id}/contacts`, { source: src.kind, url: src.url }),
};

export const campaigns = {
  all: () => call<{ data: Campaign[] }>('GET', '/v1/campaigns').then((r) => r.data),
  get: (id: string) => call<Campaign>('GET', `/v1/campaigns/${id}`),
  create: (b: { name: string; template_id: string; list_id: string; sender_id?: string }) => call<Campaign>('POST', '/v1/campaigns', b),
  launch: (id: string, scheduled_at?: string) => call<Campaign>('POST', `/v1/campaigns/${id}/launch`, scheduled_at ? { scheduled_at } : {}),
  cancel: (id: string) => call<Campaign>('POST', `/v1/campaigns/${id}/cancel`),
  remove: (id: string) => call<void>('DELETE', `/v1/campaigns/${id}`),
  report: (id: string) => call<Report>('GET', `/v1/campaigns/${id}/report`),
};

export const apiKeys = {
  all: () => call<{ data: ApiKey[] }>('GET', '/v1/api-keys').then((r) => r.data),
  create: (name: string) => call<ApiKey>('POST', '/v1/api-keys', { name }),
  revoke: (id: string) => call<ApiKey>('POST', `/v1/api-keys/${id}/revoke`),
};
