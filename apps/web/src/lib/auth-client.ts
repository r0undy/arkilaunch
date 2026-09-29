import { tenantSlug } from './host.js';
import { decodeAccessToken } from './jwt.js';
import { clearOwner, currentOwner, markOwner, watchOwner } from './session-owner.js';
import { clearCart } from './cart-client.js';
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

// Only picks the tenant for public reads and login/signup; authed data is scoped by the JWT alone.
function hostHeaders(): Record<string, string> {
  const slug = tenantSlug();
  return slug ? { 'X-Tenant-Slug': slug } : {};
}

const REFRESH_TOKEN_KEY = 'arkilaunch.refreshToken';
const TAB_USER_KEY = 'arkilaunch.tabUser';
const USER_TAB_KEYS = ['arkilaunch.cart', 'setup-modal-seen'];

// Access token lives in memory only, never storage; bootstrapSession() re-derives it after a reload.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

// Tests only.
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

function tabUser(): string | null {
  return sessionStorage.getItem(TAB_USER_KEY);
}

// Moving the browser-wide owner marker to this user signs every other tab out.
function storeTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  const userId = decodeAccessToken(tokens.accessToken)?.sub ?? null;
  if (!userId) return;
  const previousUser = tabUser();
  if (previousUser && previousUser !== userId) {
    clearCart();
    sessionStorage.removeItem('setup-modal-seen');
  } else if (!previousUser) {
    // A visitor's cart survives into their login.
    sessionStorage.removeItem('setup-modal-seen');
  }
  sessionStorage.setItem(TAB_USER_KEY, userId);
  markOwner(userId);
}

function dropTabSession(): void {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(TAB_USER_KEY);
  for (const key of USER_TAB_KEYS) sessionStorage.removeItem(key);
}

// Never clears an owner marker another account now holds.
export function clearTokens(): void {
  const me = tabUser();
  dropTabSession();
  if (me && currentOwner() === me) clearOwner();
}

function signedOutElsewhere(): void {
  dropTabSession();
  window.location.replace('/login?reason=signed_in_elsewhere');
}

export function watchSessionOwner(): void {
  watchOwner(() => (getRefreshToken() ? tabUser() : null), signedOutElsewhere);
}

export async function bootstrapSession(): Promise<void> {
  if (!getRefreshToken()) return;
  // Another account owns the browser now: never refresh this tab's session back.
  if (!tabUser() || currentOwner() !== tabUser()) {
    dropTabSession();
    return;
  }
  try {
    await ensureFreshToken();
  } catch (err) {
    if (isAuthFailure(err)) clearTokens();
  }
}

// Only a refused refresh ends the session; a network drop, 5xx or 429 keeps it.
function isAuthFailure(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 400 || status === 401 || (err instanceof Error && err.message === 'no_refresh_token');
}

function isAuthTokens(response: AuthTokens | TwoFaChallenge): response is AuthTokens {
  return 'accessToken' in response;
}

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
    throw Object.assign(new Error(payload.error ?? 'request_failed'), { status: res.status });
  }
  return res.json() as Promise<T>;
}

// A TwoFaChallenge carries no tokens: store only real ones or presence checks see a fake sign-in.
export async function login(
  request: LoginRequest,
  turnstileToken?: string | null,
): Promise<AuthTokens | TwoFaChallenge> {
  const response = await postJson<AuthTokens | TwoFaChallenge>('/auth/login', request, turnstileToken);
  if (isAuthTokens(response)) storeTokens(response);
  return response;
}

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

export async function activateAccount(request: UserActivateRequest): Promise<void> {
  await postJson<void>('/auth/activate', request);
}

export async function requestPasswordReset(email: string, turnstileToken?: string | null): Promise<void> {
  await postJson<{ ok: true }>('/auth/forgot-password', { email }, turnstileToken);
}

// A replayed refresh token revokes the whole family, so refresh is single-flight, one per browser (Web Locks),
// and each rotation is broadcast so a duplicated tab swaps its stale copy.
// ponytail: without Web Locks this falls back to per-tab single flight.
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

// replace, not assign: Back must not return to the page that lost its session.
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
  } catch (err) {
    if (!isAuthFailure(err)) throw err;
    redirectToLogin();
    return res;
  }
}
