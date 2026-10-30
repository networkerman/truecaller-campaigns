import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { recordTap } from '../links.js';
import { applyStatusUpdate } from '../messages.js';
import type { MessagingProvider } from '../providers/types.js';

// Requests older than this are treated as replays.
const MAX_SKEW_MS = 5 * 60_000;

// X-Webhook-Signature: ts=<epoch ms>,sha256=<hex>[,sha256=<hex>...]
// Each sha256 is HMAC-SHA256(secret, ts + "." + rawBody). More than one is sent during secret rotation.
export function verifySignature(secret: string, rawBody: string, header: string | undefined, now = Date.now()) {
  if (!header) return false;
  let ts: string | undefined;
  const sigs: string[] = [];
  for (const part of header.split(',').map((p) => p.trim())) {
    if (part.startsWith('ts=')) ts = part.slice(3);
    else if (part.startsWith('sha256=')) sigs.push(part.slice(7));
  }
  if (!ts || !sigs.length) return false;
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex'));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}

export async function webhookRoutes(app: FastifyInstance, opts: { provider: MessagingProvider }) {
  // Keep the raw body for signature checks. Scoped to this plugin, so other routes parse JSON as usual.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post('/webhooks/truecaller', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Ownership check when the webhook is saved in the Truecaller portal: echo the challenge back.
    // The signing secret is only issued after this succeeds, so it can't be checked here.
    if (typeof body.code_challenge === 'string' && !Array.isArray(body.events)) {
      return { code_challenge: body.code_challenge };
    }

    if (config.tc.webhookSecret) {
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const header = req.headers['x-webhook-signature'];
      if (!verifySignature(config.tc.webhookSecret, raw, Array.isArray(header) ? header[0] : header)) {
        return reply.code(401).send({ error: 'bad signature' });
      }
    }

    const updates = opts.provider.parseWebhook(body);
    for (const u of updates) await applyStatusUpdate(u);
    for (const t of opts.provider.parseTaps?.(body) ?? []) await recordTap(t.tag, t.at);
    return { received: updates.length };
  });
}
