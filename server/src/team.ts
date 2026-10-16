import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
import { audit, hashPassword, tempPassword, type Role } from './auth.js';
import { config } from './config.js';
import { pool } from './db.js';
import { sendInviteEmail } from './mailer.js';

export const TEMP_PASSWORD_DAYS = 7;

export class TeamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Inviter {
  id: string | null;
  name: string;
}

// Gives a brand-new account (or one that never signed in) a fresh temporary password.
async function issueTempPassword(db: PoolClient, email: string, name: string) {
  const password = tempPassword();
  const { rows } = await db.query(
    `INSERT INTO users (email, name, password_hash, verified_at, must_change_password, temp_password_expires_at)
     VALUES ($1, $2, $3, now(), true, now() + make_interval(days => $4))
     ON CONFLICT (email) DO UPDATE SET password_hash = $3, must_change_password = true,
       temp_password_expires_at = now() + make_interval(days => $4), verified_at = coalesce(users.verified_at, now())
     RETURNING id`,
    [email, name, await hashPassword(password), TEMP_PASSWORD_DAYS],
  );
  return { userId: rows[0].id as string, password };
}

// Adds someone to a workspace and emails them. People with no account (or one they never signed in to)
// get a temporary password; people who already use the app just get told. The email is sent inside the
// transaction, so a failed send leaves nothing half-done.
export async function inviteToWorkspace(
  log: FastifyBaseLogger,
  db: PoolClient,
  i: { workspaceId: string; workspaceName: string; email: string; name: string; role: Role; inviter: Inviter },
) {
  const { rows } = await db.query(
    `SELECT id, must_change_password, verified_at FROM users WHERE email = $1`,
    [i.email],
  );
  const existing = rows[0];
  let userId: string;
  let password: string | null = null;
  if (!existing || existing.must_change_password || !existing.verified_at) {
    ({ userId, password } = await issueTempPassword(db, i.email, i.name));
  } else {
    userId = existing.id;
  }
  const added = await db.query(
    `INSERT INTO memberships (workspace_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING user_id`,
    [i.workspaceId, userId, i.role, i.inviter.id],
  );
  if (!added.rowCount) throw new TeamError(409, `${i.email} is already in this workspace.`);
  await sendInviteEmail(log, {
    to: i.email,
    name: i.name,
    inviterName: i.inviter.name,
    workspaceName: i.workspaceName,
    role: i.role,
    tempPassword: password,
    expiresDays: TEMP_PASSWORD_DAYS,
  });
  return { userId, newAccount: Boolean(password) };
}

export async function inTransaction<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

// A new customer workspace. Its first member is always its Owner.
export async function createWorkspace(
  log: FastifyBaseLogger,
  w: { name: string; ownerEmail: string; ownerName: string; inviter: Inviter },
) {
  return inTransaction(async (db) => {
    const { rows } = await db.query(`INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name, created_at`, [w.name]);
    const ws = rows[0];
    await inviteToWorkspace(log, db, {
      workspaceId: ws.id,
      workspaceName: ws.name,
      email: w.ownerEmail,
      name: w.ownerName,
      role: 'owner',
      inviter: w.inviter,
    });
    return ws as { id: string; name: string; created_at: string };
  });
}

// For a person who hasn't signed in yet: a new temporary password and a fresh email.
export async function resendInvite(log: FastifyBaseLogger, workspaceId: string, userId: string, inviter: Inviter) {
  return inTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT u.email, u.name, u.must_change_password, m.role, w.name AS workspace_name
       FROM memberships m JOIN users u ON u.id = m.user_id JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.workspace_id = $1 AND m.user_id = $2`,
      [workspaceId, userId],
    );
    const m = rows[0];
    if (!m) throw new TeamError(404, 'not found');
    if (!m.must_change_password) throw new TeamError(409, `${m.email} has already signed in.`);
    const { password } = await issueTempPassword(db, m.email, m.name);
    await sendInviteEmail(log, {
      to: m.email,
      name: m.name,
      inviterName: inviter.name,
      workspaceName: m.workspace_name,
      role: m.role,
      tempPassword: password,
      expiresDays: TEMP_PASSWORD_DAYS,
    });
  });
}

// At startup: every super admin without an account gets one, as Owner of the first workspace,
// with a temporary password emailed to them.
export async function bootstrapSuperAdmins(log: FastifyBaseLogger) {
  for (const email of config.superAdminEmails) {
    try {
      await inTransaction(async (db) => {
        const { rows } = await db.query(`SELECT 1 FROM users WHERE email = $1 AND verified_at IS NOT NULL`, [email]);
        if (rows.length) return;
        const { rows: ws } = await db.query(`SELECT id, name FROM workspaces ORDER BY created_at LIMIT 1`);
        const w = ws[0] ?? (await db.query(`INSERT INTO workspaces (name) VALUES ('OneXtel') RETURNING id, name`)).rows[0];
        await db.query(`DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]);
        const r = await inviteToWorkspace(log, db, {
          workspaceId: w.id,
          workspaceName: w.name,
          email,
          name: email.split('@')[0],
          role: 'owner',
          inviter: { id: null, name: 'Truecaller Campaigns' },
        });
        await audit({ workspaceId: w.id, userId: null }, 'super_admin.bootstrapped', { email, user_id: r.userId });
        log.info({ email }, 'super admin account created and invitation sent');
      });
    } catch (err) {
      log.error({ err, email }, 'could not set up super admin account');
    }
  }
}
