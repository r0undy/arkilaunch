import { PLATFORM_DOMAIN } from './host.js';

// One signed-in account per browser (QA 18), last sign-in wins. Every
// sign-in records WHO is signed in (the user id, never a token) in:
//  - localStorage: shared by every tab of this site, with a `storage` event
//    so the other tabs react at once;
//  - a cookie on the parent domain (.arkilaunch.app): shared by every
//    tenant site and the platform console, read when a tab regains focus.
// A tab whose own user no longer matches signs out. On localhost the cookie
// is host-only (browsers do not share cookies across *.localhost), so it is
// same-site only there.

const KEY = 'arkilaunch.sessionOwner';
const COOKIE = 'arki_owner';

function parentDomain(hostname: string): string | null {
  return hostname === PLATFORM_DOMAIN || hostname.endsWith(`.${PLATFORM_DOMAIN}`) ? PLATFORM_DOMAIN : null;
}

function writeCookie(value: string, maxAge?: number) {
  const domain = parentDomain(window.location.hostname);
  document.cookie = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    ...(domain ? [`Domain=.${domain}`] : []),
    ...(window.location.protocol === 'https:' ? ['Secure'] : []),
    ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []),
  ].join('; ');
}

function readCookie(): string | null {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null;
}

// Storage can throw (private mode, blocked site data): the marker is then
// just absent, and the tab keeps working as a single-tab session.
function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// Who is signed in on this browser now: the cookie spans every ArkiLaunch
// site, so it wins; localStorage covers a browser that refuses the cookie.
export function currentOwner(): string | null {
  return safe(readCookie) ?? safe(() => localStorage.getItem(KEY));
}

export function markOwner(userId: string): void {
  safe(() => localStorage.setItem(KEY, userId));
  safe(() => writeCookie(userId));
}

export function clearOwner(): void {
  safe(() => localStorage.removeItem(KEY));
  safe(() => writeCookie('', 0));
}

// Calls `onLost` when another sign-in (or a sign-out) elsewhere means this
// tab's user is no longer the browser's. `me` reads this tab's user id, or
// null when the tab is signed out (nothing to lose then).
export function watchOwner(me: () => string | null, onLost: () => void): () => void {
  const check = () => {
    const mine = me();
    if (mine && currentOwner() !== mine) onLost();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) check();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
