import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function generateKey() {
  const key = `tc_live_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

// Accepts the bootstrap keys from API_KEYS (used by the dashboard) or any active key created on the API keys page.
export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key) {
    if (config.apiKeys.includes(key)) return;
    const { rowCount } = await pool.query(
      `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hashKey(key)],
    );
    if (rowCount) return;
  }
  return reply.code(401).send({ error: 'invalid or missing x-api-key' });
}
