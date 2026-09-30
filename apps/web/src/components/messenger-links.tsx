import { normalizePhMobile, PH_MOBILE_REGEX } from '@arkilaunch/shared';

// Free Viber/Telegram deep links for a PH mobile; null for landlines or junk so callers keep tel:.
// viber://chat, not viber://call: desktop Viber only reliably opens chats; the call button is one tap in.
export function messengerHrefs(phone: string | null | undefined) {
  const mobile = phone ? normalizePhMobile(phone) : '';
  if (!PH_MOBILE_REGEX.test(mobile)) return null;
  return { viber: `viber://chat?number=${encodeURIComponent(mobile)}`, telegram: `https://t.me/${mobile}` };
}

// A number's own link: Viber for a mobile, the dialer otherwise.
export function phoneHref(phone: string) {
  return messengerHrefs(phone)?.viber ?? `tel:${phone.replace(/[^\d+]/g, '')}`;
}

// Rendered beside a number linked with phoneHref: the dialer and Telegram as the other options.
export function MessengerLinks({ phone, className = 'underline' }: { phone: string | null | undefined; className?: string }) {
  const hrefs = messengerHrefs(phone);
  if (!hrefs || !phone) return null;
  return (
    <>
      {' · '}
      <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={className}>Call</a>
      {' · '}
      <a href={hrefs.telegram} target="_blank" rel="noreferrer" className={className}>Telegram</a>
    </>
  );
}
