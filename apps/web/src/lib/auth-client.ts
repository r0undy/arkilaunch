import type { AuthTokens, LoginRequest, RefreshRequest, TwoFaChallenge } from '@arkilaunch/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

const ACCESS_TOKEN_KEY = 'arkilaunch.accessToken';
const REFRESH_TOKEN_KEY = 'arkilaunch.refreshToken';

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

function storeTokens(tokens: AuthTokens): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

function isAuthTokens(response: AuthTokens | TwoFaChallenge): response is AuthTokens {
  return 'accessToken' in response;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
export async function login(request: LoginRequest): Promise<AuthTokens | TwoFaChallenge> {
  const response = await postJson<AuthTokens | TwoFaChallenge>('/auth/login', request);
  if (isAuthTokens(response)) storeTokens(response);
  return response;
}

export async function refresh(request: RefreshRequest): Promise<AuthTokens> {
  const tokens = await postJson<AuthTokens>('/auth/refresh', request);
  storeTokens(tokens);
  return tokens;
}

// Single-flight refresh: apps/api/test/refresh-rotation.spec.ts proves a
// refresh token replayed after rotation revokes the ENTIRE token family, so
// two concurrent refresh calls with the same stored refresh token would not
// just fail one of them -- they would destroy the session. Every concurrent
// 401 must await the same in-flight refresh promise rather than each firing
// its own POST /auth/refresh. sessionStorage is per-tab, so there is no
// cross-tab race to additionally guard against here.
let inflightRefresh: Promise<AuthTokens> | null = null;

export function ensureFreshToken(): Promise<AuthTokens> {
  if (inflightRefresh) return inflightRefresh;
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error('no_refresh_token'));
  }
  inflightRefresh = refresh({ refreshToken }).finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

function redirectToLogin(): void {
  clearTokens();
  const dest = window.location.pathname + window.location.search;
  window.location.assign(`/login?redirect=${encodeURIComponent(dest)}`);
}

export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = getAccessToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
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
