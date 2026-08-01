import type { AuthTokens, LoginRequest, RefreshRequest } from '@arkilaunch/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

const ACCESS_TOKEN_KEY = 'arkilaunch.accessToken';
const REFRESH_TOKEN_KEY = 'arkilaunch.refreshToken';

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

function storeTokens(tokens: AuthTokens): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
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

export async function login(request: LoginRequest): Promise<AuthTokens> {
  const tokens = await postJson<AuthTokens>('/auth/login', request);
  storeTokens(tokens);
  return tokens;
}

export async function refresh(request: RefreshRequest): Promise<AuthTokens> {
  const tokens = await postJson<AuthTokens>('/auth/refresh', request);
  storeTokens(tokens);
  return tokens;
}

export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  });
}
