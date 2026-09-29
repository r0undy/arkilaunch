import { PLATFORM_DOMAIN } from './host.js';

// One signed-in account per browser, last sign-in wins. Records the user id (never a token) in localStorage
// across tabs and a parent-domain cookie across tenant sites; *.localhost cannot share the cookie.

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

// Storage can throw (private mode): the tab then runs as a single-tab session.
function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

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
