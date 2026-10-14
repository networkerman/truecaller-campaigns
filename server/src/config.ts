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
};

// Guardrails from Truecaller's promo sender rules (India numbers). Promo senders start at Tier 1.
export const guardrails = {
  promoDailySenderLimit: Number(env.PROMO_DAILY_SENDER_LIMIT ?? 500_000),
  promoPerSenderReceiver28d: 4,
  promoPerUserPerDay: 3,
};

// Campaign sending speed, messages per second per worker.
export const sendRate = Number(env.CAMPAIGN_SEND_RATE ?? 20);

// api: HTTP only (App Runner). worker: campaign sender only (ECS). all: both, for local dev.
export const runMode = (env.RUN_MODE ?? 'all') as 'api' | 'worker' | 'all';
