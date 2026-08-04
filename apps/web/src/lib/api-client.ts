import { authorizedFetch } from './auth-client.js';

// Minimal JSON helpers for the POC screens (quotes/edtr/kyc) and the
// TanStack Query layer alike.
export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(typeof payload === 'object' && payload && 'error' in payload ? String((payload as { error: unknown }).error) : `request_failed_${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await authorizedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await authorizedFetch(path);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}
