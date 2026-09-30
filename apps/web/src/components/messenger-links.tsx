import { normalizePhMobile, PH_MOBILE_REGEX } from '@arkilaunch/shared';

// Free Viber/Telegram deep links for a PH mobile; null for landlines or junk so callers keep tel:.
export function messengerHrefs(phone: string | null | undefined) {
  const mobile = phone ? normalizePhMobile(phone) : '';
  if (!PH_MOBILE_REGEX.test(mobile)) return null;
  return { viber: `viber://call?number=${encodeURIComponent(mobile)}`, telegram: `https://t.me/${mobile}` };
}

export function MessengerLinks({ phone, className = 'underline' }: { phone: string | null | undefined; className?: string }) {
  const hrefs = messengerHrefs(phone);
  if (!hrefs) return null;
  return (
    <>
      {' · '}
      <a href={hrefs.viber} className={className}>Viber</a>
      {' · '}
      <a href={hrefs.telegram} target="_blank" rel="noreferrer" className={className}>Telegram</a>
    </>
  );
}
