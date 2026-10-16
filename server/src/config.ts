const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/truecaller',
  provider: (env.TC_PROVIDER ?? 'mock') as 'mock' | 'truecaller',
  tc: {
    baseUrl: env.TC_API_BASE_URL ?? '',
    apiKey: env.TC_API_KEY ?? '',
    senderId: env.TC_SENDER_ID ?? 'DEMO',
    webhookSecret: env.TC_WEBHOOK_SECRET ?? '',
    // Business Chat API v2 .proto files from the Truecaller partner portal (kept out of git).
    protoDir: env.TC_PROTO_DIR ?? new URL('../proto', import.meta.url).pathname,
    ttlSeconds: Number(env.TC_TTL_SECONDS ?? 86_400),
  },
  apiKeys: (env.API_KEYS ?? 'dev-key').split(',').map((k) => k.trim()).filter(Boolean),
  // OneXtel super admins: create workspaces, invite anyone, and open any workspace for support.
  // Comma separated emails. Each gets an account and a temporary password emailed at startup if they have none.
  superAdminEmails: (env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Used for the sign-in link in invitation emails.
  publicUrl: (env.PUBLIC_URL ?? (env.DOMAIN ? `https://${env.DOMAIN}` : 'http://localhost:5173')).replace(/\/$/, ''),
  // smtp(s)://user:pass@host:port. Without it or Tarang, invitations are written to the server log.
  smtpUrl: env.SMTP_URL ?? '',
  // Tarang email API. When the key is set, invitation emails go through Tarang instead of SMTP.
  tarangApiUrl: (env.TARANG_API_URL ?? 'https://tarang.udchowdhury.me').replace(/\/$/, ''),
  tarangApiKey: env.TARANG_API_KEY ?? '',
  tarangInviteTemplate: env.TARANG_INVITE_TEMPLATE ?? 'invite',
  mailFrom: env.MAIL_FROM ?? 'Truecaller Campaigns <no-reply@onextel.com>',
  // Session cookies need HTTPS. Turn off only for plain http testing away from localhost.
  secureCookies: env.COOKIE_SECURE !== 'false',
};

// Guardrails from Truecaller's promo sender rules (India numbers). Promo senders start at Tier 1.
export const guardrails = {
  promoDailySenderLimit: Number(env.PROMO_DAILY_SENDER_LIMIT ?? 500_000),
  promoPerSenderReceiver28d: 4,
  promoPerUserPerDay: 3,
};

// Campaign sending speed, messages per second per worker.
export const sendRate = Number(env.CAMPAIGN_SEND_RATE ?? 20);

// api: HTTP only. worker: campaign sender only. all: both, for local dev.
export const runMode = (env.RUN_MODE ?? 'all') as 'api' | 'worker' | 'all';
