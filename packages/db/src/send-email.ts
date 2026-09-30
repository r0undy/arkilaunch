// Transactional email through Resend's HTTP API (plain fetch, no SDK).
export interface EmailAttachment {
  filename: string;
  content: string; // base64
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  attachments: EmailAttachment[] = [],
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Azure Container Apps sets these; a deployed body (activation links) must never reach Log Analytics.
    const deployed = Boolean(process.env.CONTAINER_APP_NAME || process.env.CONTAINER_APP_JOB_NAME);
    console.warn(`[Email] RESEND_API_KEY not set; email to ${to} not sent.\n${subject}${deployed ? '' : `\n${text}`}`);
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
      ...(html ? { html } : {}),
      ...(attachments.length ? { attachments } : {}),
      // Replies go here while the sender is Resend's shared address.
      ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
    }),
  });
  if (!res.ok) throw new Error(`resend_failed_${res.status}`);
}
