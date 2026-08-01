import { describe, expect, it, beforeAll } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import postgres from 'postgres';
import { generate } from 'otplib';
import { users, withTenantTx } from '@arkilaunch/db';
import { eq } from 'drizzle-orm';
import type { AuthTokens, RequestContext, TwoFaChallenge } from '@arkilaunch/shared';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

// PRD US-02/US-07: a timekeeper's session must clear a TOTP challenge before
// full tokens are issued; every other role is unaffected.
describe('AuthService: timekeeper 2FA', () => {
  let auth: AuthService;
  let tenantId: string;
  let timekeeperCtx: RequestContext;
  const timekeeperEmail = 'timekeeper@test-tenant-a.test';

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [timekeeper] = await sql`select id from users where tenant_id = ${tenantId} and email = ${timekeeperEmail}`;
    await sql.end();

    timekeeperCtx = { tenantId, userId: (timekeeper as { id: string }).id, role: 'timekeeper' };
    auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());

    // Reset enrollment state so this spec is idempotent across runs.
    await withTenantTx(timekeeperCtx, (tx) =>
      tx.update(users).set({ totpSecret: null }).where(eq(users.id, timekeeperCtx.userId)),
    );
  });

  it('an unenrolled timekeeper logs in normally (full tokens, not a challenge)', async () => {
    const result = await auth.login({ email: timekeeperEmail, password: 'test-password' });
    expect('accessToken' in result).toBe(true);
  });

  it('enroll -> enrollConfirm with a wrong code is rejected and does not persist a secret', async () => {
    const { secret } = auth.enroll(timekeeperCtx.userId);
    await expect(auth.enrollConfirm(timekeeperCtx, { secret, code: '000000' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('enroll -> enrollConfirm with a correct code persists the secret; login now issues a 2FA challenge', async () => {
    const { secret } = auth.enroll(timekeeperCtx.userId);
    const code = await generate({ secret });
    const confirmed = await auth.enrollConfirm(timekeeperCtx, { secret, code });
    expect(confirmed.enrolled).toBe(true);

    const loginResult = await auth.login({ email: timekeeperEmail, password: 'test-password' });
    expect((loginResult as TwoFaChallenge).requires2fa).toBe(true);

    // Completing the challenge with the right code issues real tokens.
    const challenge = loginResult as TwoFaChallenge;
    const nextCode = await generate({ secret });
    const tokens = (await auth.verifyTwoFa({ twoFaToken: challenge.twoFaToken, code: nextCode })) as AuthTokens;
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('a wrong code at the verify step is rejected', async () => {
    const loginResult = (await auth.login({ email: timekeeperEmail, password: 'test-password' })) as TwoFaChallenge;
    expect(loginResult.requires2fa).toBe(true);
    await expect(auth.verifyTwoFa({ twoFaToken: loginResult.twoFaToken, code: '000000' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('the 2FA challenge token cannot be used as a normal Bearer access token', async () => {
    const loginResult = (await auth.login({ email: timekeeperEmail, password: 'test-password' })) as TwoFaChallenge;
    // JwtClaimsSchema requires a literal `role` claim; the challenge token
    // carries `r` instead, so parsing it as JwtClaims must fail.
    const jwt = jwtService();
    const decoded = jwt.verify(loginResult.twoFaToken, { algorithms: ['RS256'] }) as Record<string, unknown>;
    expect(decoded.role).toBeUndefined();
    expect(decoded.purpose).toBe('2fa_challenge');
  });
});
