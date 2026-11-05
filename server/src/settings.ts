import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour');

// Workspace settings. Times are India time, like Truecaller's daily limits.
export const SettingsSchema = z.object({
  window: z.object({
    enabled: z.boolean().default(false),
    start: time.default('09:00'),
    end: time.default('21:00'),
    // What a running campaign does when the window closes: wait for the next window, or stop.
    after: z.enum(['pause', 'stop']).default('pause'),
  }).prefault({}),
  frequency: z.object({
    enabled: z.boolean().default(false),
    count: z.number().int().min(1).max(100).default(5),
    days: z.number().int().min(1).max(90).default(7),
    // all: every campaign message counts; promotional: only promotional ones count and are capped.
    scope: z.enum(['all', 'promotional']).default('all'),
  }).prefault({}),
  defaults: z.object({
    category: z.enum(['transactional', 'service', 'promotional']).default('transactional'),
    ttl_hours: z.number().int().min(1).max(672).default(24),
  }).prefault({}),
  fallback: z.object({
    onexaura: z.object({
      base_url: z.string().trim().url().default('https://api.onexaura.com'),
      // Write-only: kept when the browser sends it empty.
      api_key: z.string().trim().max(100).default(''),
      // Part of the URL OnexAura posts fallback delivery reports to. Generated on first save.
      callback_token: z.string().default(''),
    }).prefault({}),
    rcs: z.object({ enabled: z.boolean().default(false), bot_id: z.string().trim().max(100).default('') })
      .default({ enabled: false, bot_id: '' }),
    whatsapp: z.object({
      enabled: z.boolean().default(false),
      waba_id: z.string().trim().max(100).default(''),
      sender: z.string().trim().max(20).default(''), // the WhatsApp business number
    }).prefault({}),
    sms: z.object({
      enabled: z.boolean().default(false),
      sender: z.string().trim().max(20).default(''), // header, e.g. ONEXTL
      entity_id: z.string().trim().max(40).default(''),
      type: z.enum(['Trans', 'SI', 'SE', 'OTP']).default('SI'),
    }).prefault({}),
  }).prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

export async function getSettings(ws: string): Promise<Settings> {
  const { rows } = await pool.query(`SELECT settings FROM workspace_settings WHERE workspace_id = $1`, [ws]);
  const parsed = SettingsSchema.safeParse(rows[0]?.settings ?? {});
  return parsed.success ? parsed.data : defaultSettings();
}

// What the dashboard sees: the API key replaced by whether one is set and its last characters.
export function publicSettings(s: Settings) {
  const key = s.fallback.onexaura.api_key;
  return {
    ...s,
    fallback: {
      ...s.fallback,
      onexaura: {
        base_url: s.fallback.onexaura.base_url,
        api_key_set: Boolean(key),
        api_key_last4: key ? key.slice(-4) : null,
        callback_url: s.fallback.onexaura.callback_token ? `${config.publicUrl}/webhooks/onexaura/${s.fallback.onexaura.callback_token}` : null,
      },
    },
  };
}

export async function saveSettings(ws: string, input: unknown) {
  const current = await getSettings(ws);
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid settings' } as const;
  const next = parsed.data;
  if (!next.fallback.onexaura.api_key) next.fallback.onexaura.api_key = current.fallback.onexaura.api_key;
  next.fallback.onexaura.callback_token = current.fallback.onexaura.callback_token || randomBytes(18).toString('base64url');
  await pool.query(
    `INSERT INTO workspace_settings (workspace_id, settings) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET settings = $2, updated_at = now()`,
    [ws, next],
  );
  return { settings: next } as const;
}

// Minutes since midnight in India time.
const istMinutes = (d: Date) => {
  const t = new Date(d.getTime() + 330 * 60_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// Whether sending is allowed now under the workspace's send window. A window like 21:00-06:00 wraps midnight.
export function inWindow(s: Settings, now = new Date()) {
  if (!s.window.enabled) return true;
  const m = istMinutes(now), a = toMin(s.window.start), b = toMin(s.window.end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

// The workspace a fallback callback URL belongs to.
export async function workspaceForCallbackToken(token: string) {
  const { rows } = await pool.query(
    `SELECT workspace_id FROM workspace_settings WHERE settings -> 'fallback' -> 'onexaura' ->> 'callback_token' = $1`,
    [token],
  );
  return (rows[0]?.workspace_id as string | undefined) ?? null;
}
