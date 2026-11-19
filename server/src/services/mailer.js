import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

/**
 * Email delivery. Providers:
 *  - 'smtp'   real delivery through any SMTP server (Brevo, Mailgun, SES, Gmail app password, …)
 *  - 'memory' tests only: messages are kept in `outbox`, nothing leaves the process
 *  - 'none'   email features are switched off; callers must say so instead of pretending to send
 * `sendMail` resolves { sent: true } ONLY after the provider accepted the message.
 */
export const outbox = [];
let transport = null;

export function emailEnabled() {
  const { provider, smtpHost } = config.email;
  return provider === 'memory' || (provider === 'smtp' && Boolean(smtpHost));
}

function getTransport() {
  if (!transport) {
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass } = config.email;
    transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transport;
}

export async function sendMail({ to, subject, text }) {
  if (!emailEnabled()) return { sent: false, reason: 'EMAIL_NOT_CONFIGURED' };
  if (config.email.provider === 'memory') {
    outbox.push({ to, subject, text, at: new Date() });
    return { sent: true };
  }
  try {
    await getTransport().sendMail({ from: config.email.from, to, subject, text });
    return { sent: true };
  } catch (err) {
    log.error('email delivery failed', { code: err.code, message: err.message });
    return { sent: false, reason: 'DELIVERY_FAILED' };
  }
}
