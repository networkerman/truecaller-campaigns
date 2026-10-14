import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function generateKey() {
  const key = `tc_live_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const SESSION_COOKIE = 'tc_session';
export const SESSION_DAYS = 14;

export function readCookie(req: FastifyRequest, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token: string | null) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_DAYS * 86400 : 0}`];
  if (config.secureCookies) attrs.push('Secure');
  return `${SESSION_COOKIE}=${token ?? ''}; ${attrs.join('; ')}`;
}

export async function createSession(userId: string) {
  const token = newToken();
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashKey(token), userId, SESSION_DAYS],
  );
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function sessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.verified_at IS NOT NULL`,
    [hashKey(token)],
  );
  return rows[0] ?? null;
}

// Customers call the API with an x-api-key header (bootstrap keys from API_KEYS or keys made on the
// API keys page). The dashboard uses the session cookie set at sign-in.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key) {
    if (config.apiKeys.includes(key)) return;
    const { rowCount } = await pool.query(
      `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hashKey(key)],
    );
    if (rowCount) return;
    return reply.code(401).send({ error: 'invalid x-api-key' });
  }
  if (await sessionUser(req)) return;
  return reply.code(401).send({ error: 'sign in, or send an x-api-key header' });
}
