import { tenantSlug } from './host.js';
import { decodeAccessToken } from './jwt.js';
import { clearOwner, currentOwner, markOwner, watchOwner } from './session-owner.js';
import type {
  CustomerSignup,
  AuthTokens,
  LoginRequest,
  RefreshRequest,
  TwoFaChallenge,
  UserActivateRequest,
  Verify2faRequest,
} from '@arkilaunch/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

// Every API call says which tenant host it came from. The API only uses it
// to pick a tenant for public reads and to scope login/signup; authenticated
// data is still scoped by the JWT alone (RFC-1).
function hostHeaders(): Record<string, string> {
  const slug = tenantSlug();
  return slug ? { 'X-Tenant-Slug': slug } : {};
}

const REFRESH_TOKEN_KEY = 'arkilaunch.refreshToken';
// Whose refresh token this tab holds, so a reload can tell whether that
// user is still the browser's signed-in account (session-owner.ts).
const TAB_USER_KEY = 'arkilaunch.tabUser';
// Per-tab state that belongs to the signed-in user, dropped with them.
const USER_TAB_KEYS = ['arkilaunch.cart', 'setup-modal-seen'];

// RFC-1 §3: "Client keeps [the access token] in memory (not localStorage)."
// Held as a module-level variable rather than sessionStorage -- it does not
// survive a reload, which is why bootstrapSession() below exists to
// silently re-derive it from the (still sessionStorage-held) refresh token.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

// Exported for tests only, which previously seeded state via
// `sessionStorage.setItem('arkilaunch.accessToken', ...)`; that key no
// longer exists, so tests call this directly instead.
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

function tabUser(): string | null {
  return sessionStorage.getItem(TAB_USER_KEY);
}

// The one place tokens are written. A different user than this tab held
// drops the old user's per-tab state (cart, welcome); the browser-wide owner
// marker then moves to this user, which signs every other tab out.
function storeTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  const userId = decodeAccessToken(tokens.accessToken)?.sub ?? null;
  if (!userId) return;
  if (tabUser() !== userId) for (const key of USER_TAB_KEYS) sessionStorage.removeItem(key);
  sessionStorage.setItem(TAB_USER_KEY, userId);
  markOwner(userId);
}

function dropTabSession(): void {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(TAB_USER_KEY);
  for (const key of USER_TAB_KEYS) sessionStorage.removeItem(key);
}

// Signing out here signs out every tab of this user (the owner marker goes
// with it), but never clears a marker another account now holds.
export function clearTokens(): void {
  const me = tabUser();
  dropTabSession();
  if (me && currentOwner() === me) clearOwner();
}

// Another account signed in on this browser (or this one signed out in
// another tab): this tab leaves without touching that account's session.
function signedOutElsewhere(): void {
  dropTabSession();
  window.location.replace('/login?reason=signed_in_elsewhere');
}

// Registered once at boot (main.tsx).
export function watchSessionOwner(): void {
  watchOwner(() => (getRefreshToken() ? tabUser() : null), signedOutElsewhere);
}

// Called once on app boot (main.tsx) before the router renders: a page
// reload always starts with accessToken === null now, so without this every
// reload of an authed route would bounce to /login even with a perfectly
// valid refresh token sitting in sessionStorage.
export async function bootstrapSession(): Promise<void> {
  if (!getRefreshToken()) return;
  // Someone else signed in on this browser since (or this user signed out
  // in another tab): this tab's session is over; never refresh it back.
  if (!tabUser() || currentOwner() !== tabUser()) {
    dropTabSession();
    return;
  }
  try {
    await ensureFreshToken();
  } catch {
    clearTokens();
  }
}

function isAuthTokens(response: AuthTokens | TwoFaChallenge): response is AuthTokens {
  return 'accessToken' in response;
}

// Header name matches apps/api/src/common/turnstile.ts TURNSTILE_HEADER.
export function turnstileHeaders(token?: string | null): Record<string, string> {
  return token ? { 'X-Turnstile-Token': token } : {};
}

async function postJson<T>(path: string, body: unknown, turnstileToken?: string | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...hostHeaders(), ...turnstileHeaders(turnstileToken) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? 'request_failed');
  }
  return res.json() as Promise<T>;
}

// AuthService.login can return a TwoFaChallenge (no accessToken/refreshToken
// at all) instead of AuthTokens for a timekeeper with TOTP enrolled. Storing
// tokens unconditionally here used to write the literal string "undefined"
// into sessionStorage, which then passed every getAccessToken() presence
// check downstream -- a silent fake "signed in" state. Only store real
// tokens; the caller (login.tsx) must branch on the discriminant.
// turnstileToken: only needed after repeated failures, when the API
// answers 'captcha_required' (turnstile CR).
export async function login(
  request: LoginRequest,
  turnstileToken?: string | null,
): Promise<AuthTokens | TwoFaChallenge> {
  const response = await postJson<AuthTokens | TwoFaChallenge>('/auth/login', request, turnstileToken);
  if (isAuthTokens(response)) storeTokens(response);
  return response;
}

// POST /auth/register-customer: storefront self-signup, signed straight in.
export async function registerCustomer(request: CustomerSignup, turnstileToken?: string | null): Promise<AuthTokens> {
  const tokens = await postJson<AuthTokens>('/auth/register-customer', request, turnstileToken);
  storeTokens(tokens);
  return tokens;
}

export async function refresh(request: RefreshRequest): Promise<AuthTokens> {
  const tokens = await postJson<AuthTokens>('/auth/refresh', request);
  storeTokens(tokens);
  return tokens;
}

export async function verify2fa(request: Verify2faRequest): Promise<AuthTokens> {
  const tokens = await postJson<AuthTokens>('/auth/2fa/verify', request);
  storeTokens(tokens);
  return tokens;
}

// POST /auth/activate: redeems the activationToken an approval hands out
// and sets the account's first password. Returns 204 with no body and no
// tokens, so the caller sends the user to /login afterwards. The endpoint
// has existed since S19 but had no client at all, which left an approved
// owner holding a token with no screen to redeem it
// (audit-api-surface.md #3).
export async function activateAccount(request: UserActivateRequest): Promise<void> {
  await postJson<void>('/auth/activate', request);
}

// POST /auth/forgot-password: always answers 200, whether or not the email
// has an account. There is no email provider; the tenant's admins are told
// and send the reset link themselves.
export async function requestPasswordReset(email: string, turnstileToken?: string | null): Promise<void> {
  await postJson<{ ok: true }>('/auth/forgot-password', { email }, turnstileToken);
}

// Single-flight refresh: apps/api/test/refresh-rotation.spec.ts proves a
// refresh token replayed after rotation revokes the ENTIRE token family, so
// two concurrent refresh calls with the same stored refresh token would not
// just fail one of them -- they would destroy the session. Every concurrent
// 401 must await the same in-flight refresh promise rather than each firing
// its own POST /auth/refresh.
//
// Across tabs: a duplicated tab starts with a COPY of this tab's
// sessionStorage, so both hold the same refresh token and the second to
// rotate it would revoke the family, signing both out. Refreshes therefore
// run one at a time per browser (Web Locks), and each rotation is announced
// (old token -> new) so a tab still holding the old copy swaps it first.
// ponytail: the announcement and the lock are both same-origin; a browser
// without Web Locks falls back to the per-tab single flight.
let inflightRefresh: Promise<AuthTokens> | null = null;
const rotations = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('arkilaunch.refresh');
rotations?.addEventListener('message', (e: MessageEvent<{ from: string; to: string }>) => {
  if (getRefreshToken() === e.data?.from) sessionStorage.setItem(REFRESH_TOKEN_KEY, e.data.to);
});

async function rotate(): Promise<AuthTokens> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('no_refresh_token');
  const tokens = await refresh({ refreshToken });
  rotations?.postMessage({ from: refreshToken, to: tokens.refreshToken });
  return tokens;
}

export function ensureFreshToken(): Promise<AuthTokens> {
  if (inflightRefresh) return inflightRefresh;
  if (!getRefreshToken()) return Promise.reject(new Error('no_refresh_token'));
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  inflightRefresh = (locks ? locks.request('arkilaunch.refresh', rotate) : rotate()).finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

// replace, not assign: Back from the login page must not return to the
// page that just lost its session.
function redirectToLogin(): void {
  clearTokens();
  const dest = window.location.pathname + window.location.search;
  window.location.replace(`/login?redirect=${encodeURIComponent(dest)}`);
}

export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = getAccessToken();
  const headers: Record<string, string> = {
    ...hostHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status !== 401 || !getRefreshToken()) return res;

  try {
    const refreshed = await ensureFreshToken();
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...headers, Authorization: `Bearer ${refreshed.accessToken}` },
    });
  } catch {
    redirectToLogin();
    return res;
  }
}
