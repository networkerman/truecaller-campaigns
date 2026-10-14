import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';

const transport = !config.tarangApiKey && config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

// Sends through Tarang with its published `verify-email` template when TARANG_API_KEY is set,
// else through SMTP_URL, else writes the link to the log.
export async function sendVerificationEmail(log: FastifyBaseLogger, to: string, name: string, link: string) {
  if (config.tarangApiKey) {
    const res = await fetch(`${config.tarangApiUrl}/v1/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.tarangApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.mailFrom,
        to: [to],
        template: {
          id: config.tarangVerifyTemplate,
          variables: { name, link, expiresHours: 24, appUrl: config.publicUrl },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Tarang send failed: ${res.status} ${await res.text()}`);
    return;
  }
  if (!transport) {
    // No mail configured: whoever runs the box can pass the link on by hand.
    log.warn({ to, link }, 'no mail configured, verification link not emailed');
    return;
  }
  await transport.sendMail({
    from: config.mailFrom,
    to,
    subject: 'Confirm your email for Truecaller Campaigns',
    text: `Hi ${name},\n\nConfirm your email to finish signing up:\n${link}\n\nThe link works for 24 hours. If you did not sign up, ignore this email.`,
  });
}
