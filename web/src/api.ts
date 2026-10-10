// The dashboard holds no key of its own: the user signs in with an API key, kept in this browser only.
const KEY_STORE = 'tc_api_key';

export const session = {
  get: () => {
    try {
      return localStorage.getItem(KEY_STORE);
    } catch {
      return null;
    }
  },
  set: (key: string) => {
    try {
      localStorage.setItem(KEY_STORE, key);
    } catch {
      /* private mode: key lasts for this page only */
    }
    memoryKey = key;
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* ignore */
    }
    memoryKey = null;
  },
};
let memoryKey: string | null = session.get();
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

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

export interface ContactList {
  id: string;
  name: string;
  columns: string[];
  contact_count: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  phone: string;
  attrs: Record<string, string>;
  created_at: string;
}

export interface ImportResult {
  rows: number;
  added: number;
  updated: number;
  duplicates: number;
  invalid: { row: number; value: string; reason: string }[];
  invalid_count: number;
  columns: string[];
}

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';

export interface CampaignStats {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  blocked: number;
}

export interface Campaign {
  id: string;
  name: string;
  template_id: string;
  template_name: string;
  list_id: string;
  list_name: string;
  list_size: number;
  sender_id: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total: number;
  stats: CampaignStats;
  created_at: string;
  updated_at: string;
}

export interface CampaignInput {
  name: string;
  template_id: string;
  list_id: string;
  sender_id?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

async function call<T>(method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-api-key': memoryKey ?? '', ...(body !== undefined ? { 'content-type': contentType } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (res.status === 401) onUnauthorized();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  checkKey: async (key: string) => {
    const res = await fetch('/v1/templates', { headers: { 'x-api-key': key } });
    return res.ok;
  },

  listTemplates: () => call<{ data: Template[] }>('GET', '/v1/templates').then((r) => r.data),
  createTemplate: (t: TemplateInput) => call<Template>('POST', '/v1/templates', t),
  updateTemplate: (id: string, t: TemplateInput) => call<Template>('PUT', `/v1/templates/${id}`, t),
  deleteTemplate: (id: string) => call<void>('DELETE', `/v1/templates/${id}`),
  submitTemplate: (id: string) => call<Template>('POST', `/v1/templates/${id}/submit`, {}),

  listLists: () => call<{ data: ContactList[] }>('GET', '/v1/lists').then((r) => r.data),
  createList: (name: string) => call<ContactList>('POST', '/v1/lists', { name }),
  deleteList: (id: string) => call<void>('DELETE', `/v1/lists/${id}`),
  listContacts: (id: string, limit = 50, offset = 0) =>
    call<{ data: Contact[] }>('GET', `/v1/lists/${id}/contacts?limit=${limit}&offset=${offset}`).then((r) => r.data),
  importCsv: (id: string, csv: string) => call<ImportResult>('POST', `/v1/lists/${id}/import`, csv, 'text/csv'),

  listCampaigns: () => call<{ data: Campaign[] }>('GET', '/v1/campaigns').then((r) => r.data),
  getCampaign: (id: string) => call<Campaign>('GET', `/v1/campaigns/${id}`),
  createCampaign: (c: CampaignInput) => call<Campaign>('POST', '/v1/campaigns', c),
  updateCampaign: (id: string, c: CampaignInput) => call<Campaign>('PUT', `/v1/campaigns/${id}`, c),
  deleteCampaign: (id: string) => call<void>('DELETE', `/v1/campaigns/${id}`),
  launchCampaign: (id: string, scheduledAt?: string) =>
    call<Campaign>('POST', `/v1/campaigns/${id}/launch`, scheduledAt ? { scheduled_at: scheduledAt } : {}),
  campaignAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'unschedule') =>
    call<Campaign>('POST', `/v1/campaigns/${id}/${action}`, {}),

  listKeys: () => call<{ data: ApiKey[] }>('GET', '/v1/api-keys').then((r) => r.data),
  createKey: (name: string) => call<ApiKey & { key: string }>('POST', '/v1/api-keys', { name }),
  revokeKey: (id: string) => call<void>('DELETE', `/v1/api-keys/${id}`),
};
