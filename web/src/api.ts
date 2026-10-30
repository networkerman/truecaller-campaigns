// The dashboard signs in with email and password. The server keeps the session in an
// httpOnly cookie, so nothing secret is stored in the browser.
let onUnauthorized: () => void = () => {};

export type Role = 'owner' | 'admin' | 'developer' | 'analyst';
export const ROLES: Role[] = ['owner', 'admin', 'developer', 'analyst'];
export type Permission = 'workspace:own' | 'members:manage' | 'keys:manage' | 'templates:manage' | 'campaigns:manage' | 'reports:view';

export interface User {
  id: string;
  email: string;
  name: string;
  must_change_password: boolean;
  super_admin: boolean;
  // support: a super admin working in a workspace they are not a member of.
  workspace: { id: string; name: string; role: Role; support: boolean } | null;
  permissions: Permission[];
  workspaces: { id: string; name: string; role: Role | null }[];
}

// Every request goes through here so an expired session sends the user back to sign-in.
async function request(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 401 && !path.startsWith('/v1/auth/')) onUnauthorized();
  return res;
}

export const auth = {
  onUnauthorized: (fn: () => void) => (onUnauthorized = fn),
  me: async (): Promise<User | null> => {
    const res = await request('/v1/auth/me');
    return res.ok ? res.json() : null;
  },
  login: (email: string, password: string) =>
    call<{ ok: true; must_change_password: boolean }>('POST', '/v1/auth/login', { email, password }),
  changePassword: (current_password: string, new_password: string) =>
    call<{ ok: true }>('POST', '/v1/auth/password', { current_password, new_password }),
  switchWorkspace: (workspace_id: string) => call<unknown>('POST', '/v1/auth/workspace', { workspace_id }),
  logout: () => call<void>('POST', '/v1/auth/logout'),
};

export type Category = 'promotional' | 'transactional' | 'service';
export type TemplateStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'video/mp4' | 'video/quicktime' | 'application/pdf' | 'text/plain';
export const MEDIA_TYPES: MediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf', 'text/plain'];
export interface Media {
  url: string;
  mime_type: MediaType;
  file_name?: string;
}
export type Button = { type: 'link'; text: string; url: string } | { type: 'reply'; text: string };

export interface Template {
  id: string;
  name: string;
  category: Category;
  body: string;
  variables: string[];
  // Used when a contact's column for that variable is empty.
  variable_defaults: Record<string, string>;
  media: Media | null;
  buttons: Button[];
  status: TemplateStatus;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type TemplateInput = Pick<Template, 'name' | 'category' | 'body'> & { variable_defaults?: Record<string, string>; media?: Media | null; buttons?: Button[] };

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
  // Stores the file on our server and returns the public URL Truecaller downloads it from.
  uploadMedia: async (file: File): Promise<Media & { size: number }> => {
    const res = await request('/v1/media', { method: 'POST', headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name) }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
    return data;
  },
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
  template_media: Media | null;
  template_buttons: Button[];
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

export interface ReasonCategory {
  key: string;
  label: string;
  hint: string;
  count: number;
  reasons: { status: 'failed' | 'blocked'; reason: string; count: number }[];
}

export interface Report {
  campaign: Campaign;
  funnel: { stage: string; count: number; bad?: boolean }[];
  rates: { delivery_rate: number; read_rate: number; click_rate: number | null; failure_rate: number; blocked_rate: number };
  timing: {
    avg_deliver_s: number | null; median_deliver_s: number | null;
    avg_read_s: number | null; median_read_s: number | null;
    avg_click_s: number | null; median_click_s: number | null;
  };
  clicks: { tracked: boolean; unique: number; total: number; by_button: { label: string; type: 'link' | 'reply' | 'text'; people: number; taps: number }[] };
  reasons: { status: 'failed' | 'blocked'; reason: string; count: number; category: string }[];
  categories: ReasonCategory[];
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
  create: (b: { name: string; template_id: string; list_id: string; sender_id?: string; variable_defaults?: Record<string, string>; track_links?: boolean }) => call<Campaign>('POST', '/v1/campaigns', b),
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

export interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  pending: boolean; // invited, hasn't signed in and set a password yet
  joined_at: string;
  invited_by: string | null;
}

export interface AuditEntry {
  id: number;
  action: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
}

export const team = {
  all: () => call<{ data: Member[] }>('GET', '/v1/team').then((r) => r.data),
  invite: (b: { email: string; name: string; role: Role }) => call<Member>('POST', '/v1/team/invitations', b),
  setRole: (userId: string, role: Role) => call<unknown>('PATCH', `/v1/team/members/${userId}`, { role }),
  remove: (userId: string) => call<void>('DELETE', `/v1/team/members/${userId}`),
  resend: (userId: string) => call<unknown>('POST', `/v1/team/members/${userId}/resend`),
  audit: () => call<{ data: AuditEntry[] }>('GET', '/v1/audit').then((r) => r.data),
};

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
  members: number;
  owners: string[] | null;
  campaigns: number;
}

export const admin = {
  workspaces: () => call<{ data: WorkspaceRow[] }>('GET', '/v1/admin/workspaces').then((r) => r.data),
  createWorkspace: (b: { name: string; owner_email: string; owner_name: string }) =>
    call<WorkspaceRow>('POST', '/v1/admin/workspaces', b),
};

// ---- Customer webhooks ----

export type WebhookEvent = 'message.sent' | 'message.delivered' | 'message.read' | 'message.failed' | 'campaign.started' | 'campaign.completed';

export interface Webhook {
  id: string;
  url: string;
  description: string;
  events: WebhookEvent[];
  enabled: boolean;
  secret: string;
  created_at: string;
  updated_at: string;
  failed_24h: number;
  last_delivered_at: string | null;
}

export type WebhookInput = Pick<Webhook, 'url' | 'description' | 'events' | 'enabled'>;

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  response_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  next_attempt_at: string | null;
  payload?: unknown;
}

export const webhooks = {
  all: () => call<{ data: Webhook[]; events: WebhookEvent[]; max_attempts: number }>('GET', '/v1/webhooks'),
  create: (w: WebhookInput) => call<Webhook>('POST', '/v1/webhooks', w),
  update: (id: string, w: WebhookInput) => call<Webhook>('PUT', `/v1/webhooks/${id}`, w),
  remove: (id: string) => call<void>('DELETE', `/v1/webhooks/${id}`),
  rotate: (id: string) => call<Webhook>('POST', `/v1/webhooks/${id}/rotate-secret`),
  test: (id: string) => call<WebhookDelivery>('POST', `/v1/webhooks/${id}/test`),
  deliveries: (id: string, status?: string) =>
    call<{ data: WebhookDelivery[] }>('GET', `/v1/webhooks/${id}/deliveries${status ? `?status=${status}` : ''}`).then((r) => r.data),
  retry: (deliveryId: string) => call<WebhookDelivery>('POST', `/v1/webhooks/deliveries/${deliveryId}/retry`, {}),
};

// ---- Senders ----

export interface SenderStats {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  not_on_truecaller: number;
  promo_today: number;
  last_sent_at: string | null;
  delivery_rate: number | null;
  read_rate: number | null;
  unreachable_rate: number | null;
  health: 'good' | 'watch' | 'poor' | 'not_enough_data';
}

export interface Sender {
  id: string;
  sender_id: string;
  display_name: string;
  category: Category;
  status: 'active' | 'paused';
  tier: number;
  daily_limit: number | null;
  effective_daily_limit: number;
  request_id: string | null;
  stats: SenderStats | null;
  created_at: string;
  has_credential?: boolean;
}

export interface SenderRequest {
  id: string;
  ref: string;
  sample_message: string;
  contact_email: string;
  sender_id: string | null;
  display_name: string;
  legal_name: string;
  category: Category;
  website: string;
  use_case: string;
  monthly_volume: string;
  status: 'submitted' | 'in_review' | 'approved' | 'rejected';
  note: string | null;
  requested_by: string | null;
  created_at: string;
}

export type SenderRequestInput = Pick<SenderRequest, 'display_name' | 'legal_name' | 'category' | 'website' | 'use_case' | 'monthly_volume' | 'sample_message' | 'contact_email'>;

export interface SendersResponse {
  data: Sender[];
  requests: SenderRequest[];
  default_sender: string;
  default_sender_stats: SenderStats | null;
  default_daily_limit: number;
  contact: { name: string; email: string | null };
  can_manage: boolean;
}

export const senders = {
  all: () => call<SendersResponse>('GET', '/v1/senders'),
  request: (r: SenderRequestInput) => call<SenderRequest>('POST', '/v1/senders/requests', r),
  add: (s: Pick<Sender, 'sender_id' | 'display_name' | 'category' | 'tier' | 'daily_limit'> & { request_id?: string }) => call<Sender>('POST', '/v1/senders', s),
  setStatus: (id: string, status: Sender['status']) => call<Sender>('PATCH', `/v1/senders/${id}`, { status }),
  update: (id: string, p: Partial<Pick<Sender, 'tier' | 'daily_limit'>>) => call<Sender>('PATCH', `/v1/senders/${id}`, p),
  setRequestStatus: (id: string, status: SenderRequest['status'], note?: string) =>
    call<SenderRequest>('PATCH', `/v1/senders/requests/${id}`, { status, note }),
};
