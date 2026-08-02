import { describe, expect, it } from 'vitest';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

// QAD-T22 (credential stuffing / brute force on /auth/login). Each `it`
// below constructs its own AuthService so the in-memory lockout Map never
// leaks between tests (or spec files -- two-fa.spec.ts's own AuthService
// instance is entirely separate). Uses the test-two-tenant seed's users
// directly by email; no per-test DB lookup needed since login() itself
// resolves the user from the email it is given.
describe('AuthService: login lockout', () => {
  function freshAuth(): AuthService {
    return new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
  }

  it('locks out further attempts after 5 consecutive failures, even with the correct password', async () => {
    const auth = freshAuth();
    const email = 'admin@test-tenant-a.test';

    for (let i = 0; i < 5; i += 1) {
      await expect(auth.login({ email, password: 'wrong-password' })).rejects.toThrow(UnauthorizedException);
    }

    // The 6th attempt is locked out before password verification even
    // runs -- rejected even though this one supplies the RIGHT password.
    let threw = false;
    try {
      await auth.login({ email, password: 'test-password' });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect((err as HttpException).getResponse()).toMatchObject({ error: 'login_locked' });
    }
    expect(threw).toBe(true);
  });

  it('a successful login clears prior failures, so lockout never fires for a legitimately-recovering user', async () => {
    const auth = freshAuth();
    const email = 'timekeeper@test-tenant-a.test';

    for (let i = 0; i < 3; i += 1) {
      await expect(auth.login({ email, password: 'wrong-password' })).rejects.toThrow(UnauthorizedException);
    }
    const success = await auth.login({ email, password: 'test-password' });
    expect(success).toBeDefined();

    // Failures reset: another 3 wrong attempts (below the threshold of 5)
    // still doesn't lock out.
    for (let i = 0; i < 3; i += 1) {
      await expect(auth.login({ email, password: 'wrong-password' })).rejects.toThrow(UnauthorizedException);
    }
    await expect(auth.login({ email, password: 'test-password' })).resolves.toBeDefined();
  });

  it('lockout is scoped per email -- brute-forcing one account never locks out another', async () => {
    const auth = freshAuth();
    for (let i = 0; i < 5; i += 1) {
      await expect(auth.login({ email: 'admin@test-tenant-b.test', password: 'wrong-password' })).rejects.toThrow(
        UnauthorizedException,
      );
    }
    // A different tenant's admin, unaffected.
    await expect(auth.login({ email: 'admin@test-tenant-a.test', password: 'test-password' })).resolves.toBeDefined();
  });
});
