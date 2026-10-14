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
  },
  apiKeys: (env.API_KEYS ?? 'dev-key').split(',').map((k) => k.trim()).filter(Boolean),
  // Who may sign up for the dashboard. Comma separated, matched against the part after @.
  allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS ?? 'onextel.com')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  // Used to build the link in verification emails.
  publicUrl: (env.PUBLIC_URL ?? (env.DOMAIN ? `https://${env.DOMAIN}` : 'http://localhost:5173')).replace(/\/$/, ''),
  // smtp(s)://user:pass@host:port. Without it, verification links are written to the server log.
  smtpUrl: env.SMTP_URL ?? '',
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
