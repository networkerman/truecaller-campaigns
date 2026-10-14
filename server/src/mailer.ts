import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

export async function sendVerificationEmail(log: FastifyBaseLogger, to: string, name: string, link: string) {
  if (!transport) {
    // No SMTP configured: whoever runs the box can pass the link on by hand.
    log.warn({ to, link }, 'SMTP_URL not set, verification link not emailed');
    return;
  }
  await transport.sendMail({
    from: config.mailFrom,
    to,
    subject: 'Confirm your email for Truecaller Campaigns',
    text: `Hi ${name},\n\nConfirm your email to finish signing up:\n${link}\n\nThe link works for 24 hours. If you did not sign up, ignore this email.`,
  });
}
