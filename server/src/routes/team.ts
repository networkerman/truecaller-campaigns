import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ROLES, audit, requireAuth, requirePermission, type Role } from '../auth.js';
import { pool } from '../db.js';
import { TeamError, createWorkspace, inTransaction, inviteToWorkspace, resendInvite } from '../team.js';

const email = z.string().trim().toLowerCase().email().max(200);
const InviteBody = z.object({ email, name: z.string().trim().min(1).max(100), role: z.enum(ROLES) });
const UserId = z.object({ userId: z.string().uuid() });

const sendTeamError = (reply: FastifyReply, err: unknown) => {
  if (err instanceof TeamError) return reply.code(err.status).send({ error: err.message });
  throw err;
};

async function actorName(userId: string | null) {
  if (!userId) return 'Truecaller Campaigns';
  const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]);
  return rows[0]?.name ?? 'Truecaller Campaigns';
}

async function workspaceName(id: string) {
  return (await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [id])).rows[0].name as string;
}

export async function teamRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  // Team management is for people; API keys can't use it.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.ctx.userId) return reply.code(403).send({ error: 'Sign in to the dashboard to manage the team.' });
  });

  app.get('/v1/team', { preHandler: requirePermission('reports:view') }, async (req) => {
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.email, u.name, m.role, u.must_change_password AS pending,
         m.created_at AS joined_at, i.name AS invited_by
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN users i ON i.id = m.invited_by
       WHERE m.workspace_id = $1 ORDER BY m.created_at`,
      [req.ctx.workspaceId],
    );
    return { data: rows };
  });

  // Invite someone into this workspace with a role. Only an Owner can make another Owner.
  app.post('/v1/team/invitations', { preHandler: requirePermission('members:manage') }, async (req, reply) => {
    const parsed = InviteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a name, a valid email and a role.' });
    const b = parsed.data;
    if (b.role === 'owner' && req.ctx.role !== 'owner') return reply.code(403).send({ error: 'Only an Owner can invite another Owner.' });
    try {
      const r = await inTransaction(async (db) =>
        inviteToWorkspace(req.log, db, {
          workspaceId: req.ctx.workspaceId,
          workspaceName: await workspaceName(req.ctx.workspaceId),
          email: b.email,
          name: b.name,
          role: b.role,
          inviter: { id: req.ctx.userId, name: await actorName(req.ctx.userId) },
        }),
      );
      await audit(req.ctx, 'member.invited', { email: b.email, role: b.role, new_account: r.newAccount });
      return reply.code(201).send({ user_id: r.userId, email: b.email, role: b.role, pending: r.newAccount });
    } catch (err) {
      req.log.error(err, 'invitation failed');
      if (err instanceof TeamError) return sendTeamError(reply, err);
      return reply.code(502).send({ error: 'Could not send the invitation email. Try again shortly.' });
    }
  });

  app.post('/v1/team/members/:userId/resend', { preHandler: requirePermission('members:manage') }, async (req, reply) => {
    const p = UserId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    try {
      await resendInvite(req.log, req.ctx.workspaceId, p.data.userId, { id: req.ctx.userId, name: await actorName(req.ctx.userId) });
      await audit(req.ctx, 'member.invite_resent', { user_id: p.data.userId });
      return { ok: true };
    } catch (err) {
      if (err instanceof TeamError) return sendTeamError(reply, err);
      req.log.error(err, 'resend failed');
      return reply.code(502).send({ error: 'Could not send the invitation email. Try again shortly.' });
    }
  });

  // Owners are protected: only an Owner can change or remove one, and a workspace always keeps one.
  const guardOwners = async (workspaceId: string, userId: string, actorRole: Role | null, newRole: Role | null) => {
    const { rows } = await pool.query(
      `SELECT role, (SELECT count(*)::int FROM memberships WHERE workspace_id = $1 AND role = 'owner') AS owners
       FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    const m = rows[0];
    if (!m) throw new TeamError(404, 'not found');
    if ((m.role === 'owner' || newRole === 'owner') && actorRole !== 'owner') throw new TeamError(403, 'Only an Owner can change Owners.');
    if (m.role === 'owner' && newRole !== 'owner' && m.owners <= 1) throw new TeamError(409, 'A workspace needs at least one Owner. Make someone else Owner first.');
    return m.role as Role;
  };

  app.patch('/v1/team/members/:userId', { preHandler: requirePermission('members:manage') }, async (req, reply) => {
    const p = UserId.safeParse(req.params);
    const b = z.object({ role: z.enum(ROLES) }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'role must be owner, admin, developer or analyst' });
    try {
      const from = await guardOwners(req.ctx.workspaceId, p.data.userId, req.ctx.role, b.data.role);
      await pool.query(`UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, [req.ctx.workspaceId, p.data.userId, b.data.role]);
      await audit(req.ctx, 'member.role_changed', { user_id: p.data.userId, from, to: b.data.role });
      return { user_id: p.data.userId, role: b.data.role };
    } catch (err) {
      return sendTeamError(reply, err);
    }
  });

  app.delete('/v1/team/members/:userId', { preHandler: requirePermission('members:manage') }, async (req, reply) => {
    const p = UserId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not found' });
    try {
      const role = await guardOwners(req.ctx.workspaceId, p.data.userId, req.ctx.role, null);
      await pool.query(`DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [req.ctx.workspaceId, p.data.userId]);
      await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND workspace_id = $2`, [p.data.userId, req.ctx.workspaceId]);
      await audit(req.ctx, 'member.removed', { user_id: p.data.userId, role });
      return reply.code(204).send();
    } catch (err) {
      return sendTeamError(reply, err);
    }
  });

  app.get('/v1/audit', { preHandler: requirePermission('members:manage') }, async (req) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.detail, a.created_at, u.email AS actor
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.workspace_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
      [req.ctx.workspaceId],
    );
    return { data: rows };
  });

  // ---- OneXtel super admins ----

  const superOnly = async (req: { ctx: { superAdmin: boolean } }, reply: FastifyReply) => {
    if (!req.ctx.superAdmin) return reply.code(403).send({ error: 'Only OneXtel super admins can do this.' });
  };

  app.get('/v1/admin/workspaces', { preHandler: superOnly }, async () => {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.created_at,
         (SELECT count(*)::int FROM memberships WHERE workspace_id = w.id) AS members,
         (SELECT array_agg(u.email ORDER BY m.created_at) FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = w.id AND m.role = 'owner') AS owners,
         (SELECT count(*)::int FROM campaigns WHERE workspace_id = w.id) AS campaigns
       FROM workspaces w ORDER BY w.created_at`,
    );
    return { data: rows };
  });

  // A separate workspace for a customer. The person invited becomes its Owner.
  app.post('/v1/admin/workspaces', { preHandler: superOnly }, async (req, reply) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(100), owner_email: email, owner_name: z.string().trim().min(1).max(100) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a workspace name and the owner\'s name and email.' });
    const b = parsed.data;
    try {
      const ws = await createWorkspace(req.log, {
        name: b.name,
        ownerEmail: b.owner_email,
        ownerName: b.owner_name,
        inviter: { id: req.ctx.userId, name: await actorName(req.ctx.userId) },
      });
      await audit({ workspaceId: ws.id, userId: req.ctx.userId }, 'workspace.created', { name: b.name, owner: b.owner_email });
      return reply.code(201).send(ws);
    } catch (err) {
      if (err instanceof TeamError) return sendTeamError(reply, err);
      req.log.error(err, 'workspace creation failed');
      return reply.code(502).send({ error: 'Could not send the invitation email, so the workspace was not created. Try again shortly.' });
    }
  });
}
