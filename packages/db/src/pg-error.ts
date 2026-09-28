// drizzle-orm wraps a driver error in DrizzleQueryError, with the Postgres
// error itself (code, constraint, RAISE message) on `cause`. Checks on
// `err.code` never matched: a unique violation surfaced as a 500.
export function pgError(err: unknown): { code?: string; constraint?: string; message?: string } {
  if (typeof err !== 'object' || err === null) return {};
  const cause = (err as { cause?: unknown }).cause;
  return (typeof cause === 'object' && cause !== null ? cause : err) as { code?: string; constraint?: string; message?: string };
}
