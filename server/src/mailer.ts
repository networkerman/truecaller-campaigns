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
