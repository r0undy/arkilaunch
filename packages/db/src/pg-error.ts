// drizzle-orm wraps driver errors in DrizzleQueryError; the Postgres error (code, constraint) is on `cause`.
export function pgError(err: unknown): { code?: string; constraint?: string; message?: string } {
  if (typeof err !== 'object' || err === null) return {};
  const cause = (err as { cause?: unknown }).cause;
  return (typeof cause === 'object' && cause !== null ? cause : err) as { code?: string; constraint?: string; message?: string };
}
