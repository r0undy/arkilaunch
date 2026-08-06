// Builds an unsigned (test-only) JWT-shaped string so client-side decode
// tests (jwt.ts, guards.ts) can exercise real payloads without a live API.
// Never validated against a signature here -- the client never verifies
// one either (AGENTS.md "Never" list: the server does that).
export function makeToken(claims: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' };
  const base64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url(header)}.${base64url(claims)}.`;
}

export function makeValidClaims(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sub: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000002',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}
