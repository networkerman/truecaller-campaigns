import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  checkPassword,
  createSession,
  hashKey,
  hashPassword,
  newToken,
  readCookie,
  sessionCookie,
  sessionUser,
} from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { sendVerificationEmail } from '../mailer.js';

const email = z.string().trim().toLowerCase().email().max(200);
const signupBody = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: z.string().min(8).max(200),
});
const loginBody = z.object({ email, password: z.string().min(1).max(200) });

const domainAllowed = (address: string) => config.allowedEmailDomains.includes(address.split('@')[1] ?? '');

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
  app.post('/v1/auth/signup', async (req, reply) => {
    const parsed = signupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Enter your name, a valid email and a password of at least 8 characters.' });
    }
    const { name, email, password } = parsed.data;
    if (!domainAllowed(email)) {
      return reply.code(403).send({ error: `Signup is open to ${config.allowedEmailDomains.map((d) => '@' + d).join(', ')} addresses only.` });
    }

    const token = newToken();
    const passwordHash = await hashPassword(password);
    // An unverified account can sign up again (new password, fresh link). A verified one cannot.
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, password_hash, verify_token_hash, verify_expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours')
       ON CONFLICT (email) DO UPDATE SET name = $2, password_hash = $3, verify_token_hash = $4,
         verify_expires_at = now() + interval '24 hours'
       WHERE users.verified_at IS NULL
       RETURNING id`,
      [email, name, passwordHash, hashKey(token)],
    );
    if (!rows.length) return reply.code(409).send({ error: 'That email already has an account. Sign in instead.' });

    const link = `${config.publicUrl}/v1/auth/verify?token=${token}`;
    try {
      await sendVerificationEmail(req.log, email, name, link);
    } catch (err) {
      req.log.error(err, 'verification email failed');
      return reply.code(502).send({ error: 'Could not send the confirmation email. Try again shortly.' });
    }
    return reply.code(201).send({ email, verification: 'sent' });
  });

  // Opened from the email. Verifies the address, signs the user in and lands them on the dashboard.
  app.get('/v1/auth/verify', async (req, reply) => {
    const token = String((req.query as Record<string, unknown>).token ?? '');
    const { rows } = token
      ? await pool.query(
          `UPDATE users SET verified_at = now(), verify_token_hash = NULL, verify_expires_at = NULL
           WHERE verify_token_hash = $1 AND verify_expires_at > now() RETURNING id`,
          [hashKey(token)],
        )
      : { rows: [] };
    if (!rows.length) return reply.redirect('/#/signin?verify=failed');
    reply.header('set-cookie', sessionCookie(await createSession(rows[0].id)));
    return reply.redirect('/#/campaigns');
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter your email and password.' });
    const { email, password } = parsed.data;
    if (tooMany(email)) return reply.code(429).send({ error: 'Too many attempts. Wait 15 minutes and try again.' });

    const { rows } = await pool.query(`SELECT id, password_hash, verified_at FROM users WHERE email = $1`, [email]);
    const user = rows[0];
    if (!user || !(await checkPassword(password, user.password_hash))) {
      fail(email);
      return reply.code(401).send({ error: 'Wrong email or password.' });
    }
    if (!user.verified_at) {
      return reply.code(403).send({ error: 'Confirm your email first. Check your inbox for the link, or sign up again to get a new one.' });
    }
    failures.delete(email);
    reply.header('set-cookie', sessionCookie(await createSession(user.id)));
    return { ok: true };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashKey(token)]);
    reply.header('set-cookie', sessionCookie(null));
    return reply.code(204).send();
  });

  app.get('/v1/auth/me', async (req, reply) => {
    const user = await sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'not signed in' });
    return user;
  });
}
