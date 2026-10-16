import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  audit,
  checkPassword,
  createSession,
  hashKey,
  hashPassword,
  isSuperAdmin,
  readCookie,
  resolveWorkspace,
  sessionCookie,
  sessionUser,
} from '../auth.js';
import { pool } from '../db.js';

// There is no public signup: accounts come from invitations (see routes/team.ts and routes/admin.ts).
const email = z.string().trim().toLowerCase().email().max(200);
const loginBody = z.object({ email, password: z.string().min(1).max(200) });
const passwordBody = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(10).max(200) });

// Slows down password guessing: 10 failed sign-ins per email per 15 minutes.
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60_000;
const tooMany = (key: string) => {
  const f = failures.get(key);
  return Boolean(f && f.until > Date.now() && f.count >= 10);
};
const fail = (key: string) => {
  const f = failures.get(key);
  if (f && f.until > Date.now()) f.count++;
  else failures.set(key, { count: 1, until: Date.now() + WINDOW_MS });
};

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter your email and password.' });
    const { email, password } = parsed.data;
    if (tooMany(email)) return reply.code(429).send({ error: 'Too many attempts. Wait 15 minutes and try again.' });

    const { rows } = await pool.query(
      `SELECT id, password_hash, verified_at, must_change_password, temp_password_expires_at < now() AS temp_expired
       FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || !user.verified_at || !(await checkPassword(password, user.password_hash))) {
      fail(email);
      return reply.code(401).send({ error: 'Wrong email or password.' });
    }
    if (user.must_change_password && user.temp_expired) {
      return reply.code(403).send({ error: 'Your temporary password has expired. Ask whoever invited you to send a new one.' });
    }
    failures.delete(email);
    reply.header('set-cookie', sessionCookie(await createSession(user.id)));
    return { ok: true, must_change_password: user.must_change_password };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashKey(token)]);
    reply.header('set-cookie', sessionCookie(null));
    return reply.code(204).send();
  });

  // Required after signing in with a temporary password; also how anyone changes their password.
  app.post('/v1/auth/password', async (req, reply) => {
    const user = await sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'not signed in' });
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Your new password needs at least 10 characters.' });
    const { current_password, new_password } = parsed.data;
    if (current_password === new_password) return reply.code(400).send({ error: 'Choose a password different from the current one.' });
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!(await checkPassword(current_password, rows[0].password_hash))) {
      return reply.code(400).send({ error: 'Your current password is wrong.' });
    }
    await pool.query(
      `UPDATE users SET password_hash = $2, must_change_password = false, temp_password_expires_at = NULL WHERE id = $1`,
      [user.id, await hashPassword(new_password)],
    );
    // Sign out every other session that knew the old password.
    await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, user.token_hash]);
    return { ok: true };
  });

  app.get('/v1/auth/me', async (req, reply) => {
    const user = await sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'not signed in' });
    const superAdmin = isSuperAdmin(user.email);
    const base = { id: user.id, email: user.email, name: user.name, must_change_password: user.must_change_password, super_admin: superAdmin };
    if (user.must_change_password) return { ...base, workspace: null, permissions: [], workspaces: [] };
    const w = await resolveWorkspace(user);
    const { rows: workspaces } = await pool.query(
      `SELECT w.id, w.name, m.role FROM workspaces w
       LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $1
       WHERE m.user_id IS NOT NULL OR $2::boolean ORDER BY (m.role IS NULL), w.name`,
      [user.id, superAdmin],
    );
    return {
      ...base,
      workspace: w && { id: w.id, name: w.name, role: w.role, support: w.support },
      permissions: w?.permissions ?? [],
      workspaces,
    };
  });

  app.post('/v1/auth/workspace', async (req, reply) => {
    const user = await sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'not signed in' });
    if (user.must_change_password) return reply.code(403).send({ error: 'Choose a new password first.', code: 'password_change_required' });
    const p = z.object({ workspace_id: z.string().uuid() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'workspace_id is required' });
    const w = await resolveWorkspace({ ...user, session_workspace_id: p.data.workspace_id });
    if (!w || w.id !== p.data.workspace_id) return reply.code(404).send({ error: 'workspace not found' });
    await pool.query(`UPDATE sessions SET workspace_id = $2 WHERE token_hash = $1`, [user.token_hash, w.id]);
    if (w.support) await audit({ workspaceId: w.id, userId: user.id }, 'support.opened', { email: user.email });
    return { id: w.id, name: w.name, role: w.role, support: w.support };
  });
}
