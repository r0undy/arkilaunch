import { authorizedFetch } from './auth-client.js';

// Minimal JSON helpers for the POC screens (quotes/edtr/kyc). Unstyled,
// happy-path only -- these are scaffolds to exercise the new F1/F3
// endpoints, not production data-fetching (no retry/cache layer yet; that
// lands with TanStack Query wiring per feature).
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await authorizedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw payload;
  return payload as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await authorizedFetch(path);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw payload;
  return payload as T;
}
