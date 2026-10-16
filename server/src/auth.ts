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

export async function createSession(userId: string, workspaceId: string | null = null) {
  const token = newToken();
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, workspace_id) VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [hashKey(token), userId, SESSION_DAYS, workspaceId],
  );
  return token;
}

export const ROLES = ['owner', 'admin', 'developer', 'analyst'] as const;
export type Role = (typeof ROLES)[number];

// Same shape as Tarang's permission matrix. Routes ask for a permission, never a role name.
const MATRIX = {
  'workspace:own': ['owner'],
  'members:manage': ['owner', 'admin'],
  'keys:manage': ['owner', 'admin', 'developer'],
  'templates:manage': ['owner', 'admin', 'developer'],
  'campaigns:manage': ['owner', 'admin', 'developer'], // lists, opt-outs, campaigns and sends
  'reports:view': ['owner', 'admin', 'developer', 'analyst'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof MATRIX;

export const can = (role: Role, p: Permission) => (MATRIX[p] as readonly Role[]).includes(role);
export const permissionsFor = (role: Role) => (Object.keys(MATRIX) as Permission[]).filter((p) => can(role, p));

// API keys can do everything in their workspace except manage people and keys.
const KEY_PERMISSIONS: Permission[] = ['templates:manage', 'campaigns:manage', 'reports:view'];

export const isSuperAdmin = (email: string) => config.superAdminEmails.includes(email.toLowerCase());

export interface Ctx {
  workspaceId: string;
  userId: string | null;
  role: Role | null; // null for API keys
  permissions: Permission[];
  superAdmin: boolean;
  // A super admin working in a workspace they are not a member of.
  support: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  must_change_password: boolean;
  session_workspace_id: string | null;
  token_hash: string;
}

export async function sessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.must_change_password, s.workspace_id AS session_workspace_id, s.token_hash
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashKey(token)],
  );
  return rows[0] ?? null;
}

// The workspace a signed-in person works in, and their role there. Falls back to their first
// membership when the session has none, or lost it. Super admins may work in any workspace.
export async function resolveWorkspace(user: SessionUser) {
  const superAdmin = isSuperAdmin(user.email);
  const pick = (where: string, args: unknown[]) =>
    pool.query(
      `SELECT w.id, w.name, m.role FROM workspaces w
       LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $1
       WHERE ${where} ORDER BY m.created_at NULLS LAST, w.created_at LIMIT 1`,
      [user.id, ...args],
    );
  let w: { id: string; name: string; role: Role | null } | undefined;
  if (user.session_workspace_id) {
    w = (await pick(`w.id = $2 AND (m.user_id IS NOT NULL OR $3::boolean)`, [user.session_workspace_id, superAdmin])).rows[0];
  }
  w ??= (await pick(`m.user_id IS NOT NULL OR $2::boolean`, [superAdmin])).rows[0];
  if (!w) return null;
  if (w.id !== user.session_workspace_id) {
    await pool.query(`UPDATE sessions SET workspace_id = $2 WHERE token_hash = $1`, [user.token_hash, w.id]);
  }
  const role: Role = w.role ?? 'owner';
  return { id: w.id, name: w.name, role, superAdmin, support: !w.role, permissions: permissionsFor(role) };
}

async function bootstrapWorkspace() {
  const { rows } = await pool.query(`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`);
  return rows[0]?.id as string | undefined;
}

// Customers call the API with an x-api-key header; the key decides the workspace. Setup keys from
// API_KEYS act in the first workspace. The dashboard uses the session cookie set at sign-in.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key) {
    let workspaceId: string | undefined;
    if (config.apiKeys.includes(key)) workspaceId = await bootstrapWorkspace();
    else {
      const { rows } = await pool.query(
        `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 AND revoked_at IS NULL RETURNING workspace_id`,
        [hashKey(key)],
      );
      workspaceId = rows[0]?.workspace_id;
    }
    if (!workspaceId) return reply.code(401).send({ error: 'invalid x-api-key' });
    req.ctx = { workspaceId, userId: null, role: null, permissions: KEY_PERMISSIONS, superAdmin: false, support: false };
    return;
  }
  const user = await sessionUser(req);
  if (!user) return reply.code(401).send({ error: 'sign in, or send an x-api-key header' });
  if (user.must_change_password) {
    return reply.code(403).send({ error: 'Choose a new password first.', code: 'password_change_required' });
  }
  const w = await resolveWorkspace(user);
  if (!w) return reply.code(403).send({ error: 'You are not in any workspace yet. Ask for an invitation.', code: 'no_workspace' });
  req.ctx = { workspaceId: w.id, userId: user.id, role: w.role, permissions: w.permissions, superAdmin: w.superAdmin, support: w.support };
}

// Use as a preHandler after requireAuth.
export const requirePermission = (p: Permission) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.ctx.permissions.includes(p)) {
    return reply.code(403).send({ error: `Your role can't do this (needs ${p}).`, code: 'forbidden' });
  }
};

export async function audit(ctx: { workspaceId: string | null; userId: string | null }, action: string, detail: unknown = null) {
  await pool.query(`INSERT INTO audit_log (workspace_id, actor_user_id, action, detail) VALUES ($1, $2, $3, $4)`, [
    ctx.workspaceId,
    ctx.userId,
    action,
    detail === null ? null : JSON.stringify(detail),
  ]);
}

// Readable temporary passwords: no 0/O or 1/l/I.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function tempPassword(length = 14) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
