import { Logger } from '@nestjs/common';

const logger = new Logger('Email');

// Transactional email through Resend's HTTP API (plain fetch, no SDK).
// Without RESEND_API_KEY (local dev, CI) the message is logged instead, so
// the activation link is still reachable from the API console.
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn(`RESEND_API_KEY not set; email to ${to} not sent.\n${subject}\n${text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'ArkiLaunch <onboarding@resend.dev>',
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`resend_failed_${res.status}`);
}
