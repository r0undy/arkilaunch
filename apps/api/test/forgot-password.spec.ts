import { describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import postgres from 'postgres';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

// POST /auth/forgot-password: the same answer for every email, so the form
// cannot be used to find out which addresses have an account. A real
// account's admins get a feed row. Uses the two-tenant seed.
describe('AuthService.forgotPassword', () => {
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());

  it('answers the same for an unknown and a known email', async () => {
    const unknown = await auth.forgotPassword({ email: `nobody-${Date.now()}@example.test` });
    const known = await auth.forgotPassword({ email: 'Timekeeper@test-tenant-a.test' });
    expect(unknown).toEqual({ ok: true });
    expect(known).toEqual(unknown);
  });

  it("alerts the account's own tenant admins, not another tenant's", async () => {
    await auth.forgotPassword({ email: 'timekeeper@test-tenant-a.test' });
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      const rows = await sql<{ email: string }[]>`
        select u.email from notifications n join users u on u.id = n.user_id
        where n.notification_type = 'password_reset_requested'
          and n.payload->>'email' = 'timekeeper@test-tenant-a.test'
          and n.created_at >= now() - interval '1 minute'
      `;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.email).toMatch(/@test-tenant-a\.test$/);
    } finally {
      await sql.end();
    }
  });
});
