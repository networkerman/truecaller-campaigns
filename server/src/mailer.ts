import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';

const transport = !config.tarangApiKey && config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

export interface Invite {
  to: string;
  name: string;
  inviterName: string;
  workspaceName: string;
  role: string;
  // Only for people who have no account yet. Existing users sign in with their own password.
  tempPassword: string | null;
  expiresDays: number;
}

const roleLabel = (r: string) => r[0].toUpperCase() + r.slice(1);

// Sends through Tarang's published `invite` template when TARANG_API_KEY is set, else through
// SMTP_URL, else writes the invitation (temporary password included) to the log for an operator to pass on.
export async function sendInviteEmail(log: FastifyBaseLogger, i: Invite) {
  const signInUrl = config.publicUrl;
  if (config.tarangApiKey) {
    const variables: Record<string, unknown> = {
      name: i.name,
      inviterName: i.inviterName,
      workspaceName: i.workspaceName,
      role: roleLabel(i.role),
      email: i.to,
      signInUrl,
      expiresDays: i.expiresDays,
      appUrl: config.publicUrl,
    };
    if (i.tempPassword) variables.tempPassword = i.tempPassword;
    const res = await fetch(`${config.tarangApiUrl}/v1/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.tarangApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.mailFrom,
        to: [i.to],
        template: { id: config.tarangInviteTemplate, variables },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Tarang send failed: ${res.status} ${await res.text()}`);
    return;
  }
  if (!transport) {
    log.warn({ to: i.to, workspace: i.workspaceName, tempPassword: i.tempPassword }, 'no mail configured, invitation not emailed');
    return;
  }
  const how = i.tempPassword
    ? `Sign in at ${signInUrl}\nEmail: ${i.to}\nTemporary password: ${i.tempPassword}\n\nYou'll choose your own password when you first sign in. The temporary password works for ${i.expiresDays} days.`
    : `Sign in at ${signInUrl} with your existing password.`;
  await transport.sendMail({
    from: config.mailFrom,
    to: i.to,
    subject: `${i.inviterName} invited you to ${i.workspaceName} on Truecaller Campaigns`,
    text: `Hi ${i.name},\n\n${i.inviterName} invited you to the ${i.workspaceName} workspace as ${roleLabel(i.role)}.\n\n${how}\n`,
  });
}

async function tarangSend(payload: Record<string, unknown>) {
  const res = await fetch(`${config.tarangApiUrl}/v1/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.tarangApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.mailFrom, ...payload }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Tarang send failed: ${res.status} ${await res.text()}`);
}

// Plain notification email (sender requests and the like). Never throws: a failed notice
// is logged and must not undo the action that triggered it.
export async function sendNotice(log: FastifyBaseLogger, n: { to: string[]; subject: string; text: string }) {
  const to = [...new Set(n.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return;
  try {
    if (config.tarangApiKey) await tarangSend({ to, subject: n.subject, text: n.text });
    else if (transport) await transport.sendMail({ from: config.mailFrom, to, subject: n.subject, text: n.text });
    else log.warn({ to, subject: n.subject }, 'no mail configured, notice not emailed');
  } catch (err) {
    log.error({ err, to, subject: n.subject }, 'notice email failed');
  }
}

// Security notice for a new API key, through Tarang's published `api-key-created` template.
export async function sendApiKeyCreatedEmail(
  log: FastifyBaseLogger,
  k: { to: { email: string; name: string }[]; actor: string; keyName: string; last4: string; createdAt: Date },
) {
  const keysUrl = `${config.publicUrl}/#/api-keys`;
  for (const r of k.to) {
    const key = { name: k.keyName, last4: k.last4, createdAt: k.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' };
    try {
      if (config.tarangApiKey) {
        await tarangSend({ to: [r.email], template: { id: 'api-key-created', variables: { name: r.name, actor: k.actor, key, keysUrl, appUrl: config.publicUrl } } });
      } else {
        await sendNotice(log, {
          to: [r.email],
          subject: `New API key created: ${k.keyName}`,
          text: `Hi ${r.name},\n\n${k.actor} created the API key "${k.keyName}" (ending ${k.last4}) at ${key.createdAt}.\n\nIf you didn't expect this, revoke it: ${keysUrl}\n`,
        });
      }
    } catch (err) {
      log.error({ err, to: r.email }, 'api key email failed');
    }
  }
}
