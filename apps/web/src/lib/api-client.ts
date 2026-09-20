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

// POST multipart/form-data (EDTR/KYC file capture, backend-unblock plan
// workstream 4 -- replaces the old base64 data: URL hack). No
// Content-Type header set here: the browser derives the multipart
// boundary itself, which it cannot do if we set the header manually.
export async function apiPostForm<T>(path: string, fields: Record<string, string>, file?: File): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append('file', file);

  const res = await authorizedFetch(path, { method: 'POST', body: form });
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

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await authorizedFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

export async function apiDelete(path: string): Promise<void> {
  const res = await authorizedFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload);
  }
}

// Quotes, KYC and checkout each dumped `JSON.stringify(error)` into the page
// -- an API error code in a <pre> block is developer output, not an answer.
// The codes are snake_case (`rate_card_expired`), which reads as a sentence
// with the underscores taken out, so this is a formatter rather than a
// per-screen message table. Screens with a real vocabulary of failures still
// get their own mapper (lib/booking-error.ts, lib/edtr-error.ts).
export function apiErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.message;
    if (code && !/^request_failed_/.test(code)) {
      const words = code.replace(/_/g, ' ');
      return words.charAt(0).toUpperCase() + words.slice(1) + '.';
    }
    if (error.status === 401 || error.status === 403) return 'You are not allowed to do that.';
    if (error.status >= 500) return 'The server could not complete that. Try again in a moment.';
    return 'That request was rejected. Check the details and try again.';
  }
  return 'Something went wrong. Try again in a moment.';
}
