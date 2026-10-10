const API_KEY = import.meta.env.VITE_API_KEY ?? 'dev-key';

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
  const res = await fetch(path, {
    method,
    headers: { 'x-api-key': API_KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
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
