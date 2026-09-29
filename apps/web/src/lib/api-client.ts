import { authorizedFetch } from './auth-client.js';

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

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorizedFetch(path, init);
  // A 204 (or any empty body) reads as {}.
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

export const apiGet = <T>(path: string) => send<T>(path);
export const apiPost = <T>(path: string, body: unknown, headers: Record<string, string> = {}) =>
  send<T>(path, json('POST', body, headers));
export const apiPatch = <T>(path: string, body: unknown) => send<T>(path, json('PATCH', body));
export const apiPut = <T>(path: string, body: unknown) => send<T>(path, json('PUT', body));
export const apiDelete = (path: string) => send<unknown>(path, { method: 'DELETE' }).then(() => undefined);

// Multipart: no Content-Type header, so the browser sets the boundary itself.
export function apiPostForm<T>(path: string, fields: Record<string, string>, file?: File): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append('file', file);
  return send<T>(path, { method: 'POST', body: form });
}

// Leaves for a real http(s) payment page only; the stub adapter answers "about:blank?...".
export function followCheckout(url: string | null): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  window.location.assign(url);
  return true;
}

export function apiErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.message;
    // A rental company not yet linked to PayMongo takes cash only
    // (booking, truck and weekly-invoice checkouts all answer this).
    if (code === 'online_payment_unavailable') {
      return 'This rental company does not take online payment yet. Choose cash at the office instead.';
    }
    if (code === 'company_already_applied') {
      return 'You already applied for this company. Open it under Applications instead of adding it again.';
    }
    if (code === 'site_proof_required') {
      return 'This site needs its proof first: a photo of the site and a permit, NTP or contract, title or lease, or barangay clearance. Add them under the company sites.';
    }
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
