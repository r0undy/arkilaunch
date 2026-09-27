// Transactional email through Resend's HTTP API (plain fetch, no SDK).
// Without RESEND_API_KEY (local dev, CI) the message is logged instead, so
// the activation link is still reachable from the console. Lives here, not
// in the API, so the jobs (weekly-billing) send the same way.
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[Email] RESEND_API_KEY not set; email to ${to} not sent.\n${subject}\n${text}`);
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
    }),
  });
  if (!res.ok) throw new Error(`resend_failed_${res.status}`);
}
