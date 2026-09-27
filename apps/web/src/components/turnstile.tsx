import { useEffect, useRef, useState } from 'react';

// Cloudflare Turnstile widget (turnstile CR). Managed mode: most visitors
// get an automatic pass in about a second and never see a puzzle. Unset
// site key (local dev, tests) renders nothing and callers skip the check.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error('turnstile_load_failed'));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

// Tokens are single-use: remount with a new `key` to get a fresh one after
// a failed submit. onToken(null) means expired or errored.
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          size: 'flexible',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div>
      <div ref={container} className="min-h-[65px]" />
      {loadFailed && (
        <p role="alert" className="text-sm text-error">
          The security check could not load. Turn off any content blocker for this site and reload.
        </p>
      )}
    </div>
  );
}

// The API's Turnstile refusals (apps/api/src/common/turnstile.ts), in
// words; null for any other error code.
export function captchaError(code: string): string | null {
  if (code === 'captcha_required' || code === 'captcha_failed') return 'Please complete the security check and try again.';
  if (code === 'captcha_unavailable') return 'The security check is down right now. Try again in a minute.';
  return null;
}
