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
  // Campaign messages handed to the provider per second
  sendRatePerSecond: Math.max(1, Number(env.SEND_RATE_PER_SECOND ?? 20)),
  // Bootstrap keys from the environment. Keys made on the API keys page live in the database.
  apiKeys: (env.API_KEYS ?? 'dev-key').split(',').map((k) => k.trim()).filter(Boolean),
};
