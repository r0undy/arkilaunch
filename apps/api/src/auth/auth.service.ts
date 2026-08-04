import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { findUserByEmailForAuth, users, withTenantTx } from '@arkilaunch/db';
import { eq } from 'drizzle-orm';
import type {
  AuthTokens,
  Enroll2faConfirmRequest,
  LoginRequest,
  RefreshRequest,
  RequestContext,
  TwoFaChallenge,
  UserActivateRequest,
  Verify2faRequest,
} from '@arkilaunch/shared';
import { RefreshTokenService } from './refresh-token.service.js';
import { TotpService } from './totp.service.js';

const ACCESS_TOKEN_TTL_SECONDS = 600; // ~10 min, RFC-1 §3
const TWO_FA_CHALLENGE_TTL_SECONDS = 300; // 5 min
const TWO_FA_CHALLENGE_PURPOSE = '2fa_challenge';
const ACTIVATION_TOKEN_TTL_SECONDS = 72 * 60 * 60; // 72h, S19
const ACTIVATION_TOKEN_PURPOSE = 'user_activation';
// System GUC placeholder for the pre-login lookup this shares with
// RefreshTokenService.BOOTSTRAP_ROLE -- RLS filters on tenant_id only, role
// is informational.
const BOOTSTRAP_ROLE = 'system';
// Only the timekeeper role is gated behind 2FA (PRD US-02, US-07); other
// roles are unaffected by this slice.
const TWO_FA_ENFORCED_ROLE = 'timekeeper';

// QAD-T22 (credential stuffing / brute force on /auth/login). In-process
// only (no Redis in V1, BUILD §3; resets on restart) -- keyed by the
// lowercased email rather than tenant_id, since login runs before any
// tenant context exists (the same "same error for bad email, bad
// password" no-enumeration posture this file already has). users.email is
// only unique per-tenant, so two different tenants' users sharing an
// email string would share a lockout window; accepted as a rare,
// non-security-weakening edge case rather than a reason to add a
// per-tenant lockout table.
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60_000;

interface LoginAttemptState {
  failCount: number;
  windowStart: number;
}

interface TwoFaChallengePayload {
  sub: string;
  tenantId: string;
  r: string; // deliberately not `role`: see the comment on signTwoFaChallenge
  purpose: typeof TWO_FA_CHALLENGE_PURPOSE;
}

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, LoginAttemptState>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
  ) {}

  async login({ email, password }: LoginRequest): Promise<AuthTokens | TwoFaChallenge> {
    const normalizedEmail = email.toLowerCase();
    this.assertNotLockedOut(normalizedEmail);

    const user = await findUserByEmailForAuth(normalizedEmail);
    // Same error for bad email, bad password (RFC-1 §3): no user-enumeration signal.
    if (!user || user.status !== 'active') {
      this.recordLoginFailure(normalizedEmail);
      throw new UnauthorizedException('invalid_credentials');
    }

    const passwordOk = await verify(user.passwordHash, password);
    if (!passwordOk) {
      this.recordLoginFailure(normalizedEmail);
      throw new UnauthorizedException('invalid_credentials');
    }

    this.loginAttempts.delete(normalizedEmail);

    if (user.roleName === TWO_FA_ENFORCED_ROLE) {
      const enrolled = await this.hasTotpEnrolled(user.tenantId, user.id, user.roleName);
      if (enrolled) {
        return {
          requires2fa: true,
          twoFaToken: this.signTwoFaChallenge(user.tenantId, user.id, user.roleName),
        };
      }
      // Not yet enrolled: let them in so they can reach the enroll
      // endpoints. PRD: "Timekeeper onboarding requires 2FA enrollment
      // before first EDTR submission" -- enforced at EDTR capture (RFC-2),
      // not at login, so an unenrolled timekeeper is not locked out entirely.
    }

    return this.issueTokens(user.tenantId, user.id, user.roleName);
  }

  // POST /auth/2fa/verify: completes the challenge from login() and issues
  // the real access/refresh tokens, exactly like a normal login would.
  async verifyTwoFa({ twoFaToken, code }: Verify2faRequest): Promise<AuthTokens> {
    const payload = this.verifyTwoFaChallenge(twoFaToken);
    const secret = await this.getTotpSecret(payload.tenantId, payload.sub, payload.r);
    if (!secret || !(await this.totp.verify(code, secret))) {
      throw new UnauthorizedException('invalid_totp_code');
    }
    return this.issueTokens(payload.tenantId, payload.sub, payload.r);
  }

  // POST /auth/2fa/enroll (authenticated): generates a secret but does NOT
  // persist it yet -- the client must prove it can generate a valid code
  // (enrollConfirm) before it is written to users.totp_secret, so a
  // dropped/garbled QR scan can never silently lock a timekeeper out.
  enroll(accountLabel: string): { secret: string; otpauthUrl: string } {
    const secret = this.totp.generateSecret();
    return { secret, otpauthUrl: this.totp.keyUri(accountLabel, secret) };
  }

  async enrollConfirm(ctx: RequestContext, { secret, code }: Enroll2faConfirmRequest): Promise<{ enrolled: true }> {
    if (!(await this.totp.verify(code, secret))) {
      throw new UnauthorizedException('invalid_totp_code');
    }
    await withTenantTx(ctx, (tx) =>
      tx.update(users).set({ totpSecret: secret }).where(eq(users.id, ctx.userId)),
    );
    return { enrolled: true };
  }

  // POST /auth/activate (@Public, S19): completes an invite. There is no
  // email provider anywhere in the pinned stack (BUILD §3), so
  // UsersService.invite() returns a stateless activation token in its
  // response for the admin to relay out-of-band, rather than persisting an
  // invitation row. Single-use falls out of binding the token to the
  // invited user's own (unusable, random) password hash: activation
  // changes that hash, so the token's `pwv` no longer matches and it dies.
  async activate({ activationToken, password }: UserActivateRequest): Promise<void> {
    // No JWT on this route (it is @Public -- the caller is not
    // authenticated yet). The activation token itself carries the only
    // tenant/user context available; withTenantTx still runs with a real
    // GUC so RLS is enforced, it is just sourced from the token's own
    // signed claims rather than a verified access token.
    const payload = this.verifyActivationToken(activationToken);

    await withTenantTx({ tenantId: payload.tenantId, userId: payload.sub, role: BOOTSTRAP_ROLE }, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, payload.sub)).limit(1);
      if (!user || user.status !== 'invited') {
        throw new UnauthorizedException('invalid_activation_token');
      }
      if (this.hashForActivation(user.passwordHash) !== payload.pwv) {
        // Either already activated (hash changed) or re-invited (hash
        // rerolled) since this token was issued -- dead either way.
        throw new UnauthorizedException('invalid_activation_token');
      }

      const passwordHash = await hash(password);
      await tx.update(users).set({ passwordHash, status: 'active' }).where(eq(users.id, payload.sub));
    });
  }

  // Binds the token to the CURRENT password hash so activation (which
  // changes it) and re-invite (which rerolls it) both invalidate every
  // outstanding token for that user with no extra state to track.
  signActivationToken(tenantId: string, userId: string, passwordHash: string): string {
    return this.jwtService.sign(
      { sub: userId, tenantId, pwv: this.hashForActivation(passwordHash), purpose: ACTIVATION_TOKEN_PURPOSE },
      { expiresIn: ACTIVATION_TOKEN_TTL_SECONDS, algorithm: 'RS256' },
    );
  }

  private hashForActivation(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 32);
  }

  private verifyActivationToken(token: string): { sub: string; tenantId: string; pwv: string } {
    let payload: unknown;
    try {
      payload = this.jwtService.verify(token, { algorithms: ['RS256'] });
    } catch {
      throw new UnauthorizedException('invalid_activation_token');
    }
    const candidate = payload as Partial<{ sub: string; tenantId: string; pwv: string; purpose: string }>;
    if (
      typeof candidate.sub !== 'string' ||
      typeof candidate.tenantId !== 'string' ||
      typeof candidate.pwv !== 'string' ||
      candidate.purpose !== ACTIVATION_TOKEN_PURPOSE
    ) {
      throw new UnauthorizedException('invalid_activation_token');
    }
    return candidate as { sub: string; tenantId: string; pwv: string };
  }

  async refresh({ refreshToken }: RefreshRequest): Promise<AuthTokens> {
    const rotated = await this.refreshTokens.rotate(refreshToken);
    const accessToken = this.signAccessToken(rotated.tenantId, rotated.userId, rotated.role);

    return {
      accessToken,
      refreshToken: rotated.issued.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private async issueTokens(tenantId: string, userId: string, role: string): Promise<AuthTokens> {
    const accessToken = this.signAccessToken(tenantId, userId, role);
    const { token: refreshToken } = await this.refreshTokens.issue(tenantId, userId, role);
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  // Rejects an attempt outright once the threshold is hit within the
  // window, before password verification even runs (QAD-T22: "attempts
  // logged" -- rejecting pre-verify avoids spending an argon2 hash on an
  // attempt already known to be locked out).
  private assertNotLockedOut(email: string): void {
    const state = this.loginAttempts.get(email);
    if (!state) return;
    const elapsedMs = Date.now() - state.windowStart;
    if (elapsedMs > LOGIN_LOCKOUT_WINDOW_MS) {
      this.loginAttempts.delete(email);
      return;
    }
    if (state.failCount >= LOGIN_LOCKOUT_THRESHOLD) {
      throw new HttpException(
        { error: 'login_locked', retryAfterSeconds: Math.ceil((LOGIN_LOCKOUT_WINDOW_MS - elapsedMs) / 1000) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordLoginFailure(email: string): void {
    const now = Date.now();
    const state = this.loginAttempts.get(email);
    if (!state || now - state.windowStart > LOGIN_LOCKOUT_WINDOW_MS) {
      this.loginAttempts.set(email, { failCount: 1, windowStart: now });
    } else {
      state.failCount += 1;
    }
  }

  private async hasTotpEnrolled(tenantId: string, userId: string, role: string): Promise<boolean> {
    return (await this.getTotpSecret(tenantId, userId, role)) !== null;
  }

  private async getTotpSecret(tenantId: string, userId: string, role: string): Promise<string | null> {
    const rows = await withTenantTx({ tenantId, userId, role }, (tx) =>
      tx.select({ totpSecret: users.totpSecret }).from(users).where(eq(users.id, userId)),
    );
    return rows[0]?.totpSecret ?? null;
  }

  private signAccessToken(tenantId: string, userId: string, role: string): string {
    return this.jwtService.sign(
      { sub: userId, tenantId, role },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'RS256' },
    );
  }

  // Deliberately does NOT sign `{ sub, tenantId, role, ... }` (which would
  // structurally satisfy JwtClaimsSchema and let this challenge token pass
  // as a real Bearer token on any guarded route). The `r` key and the
  // `purpose` marker mean JwtStrategy.validate's JwtClaimsSchema.parse always
  // rejects it, so it is single-purpose by construction, not convention.
  private signTwoFaChallenge(tenantId: string, userId: string, role: string): string {
    const payload: Omit<TwoFaChallengePayload, 'iat' | 'exp'> = {
      sub: userId,
      tenantId,
      r: role,
      purpose: TWO_FA_CHALLENGE_PURPOSE,
    };
    return this.jwtService.sign(payload, {
      expiresIn: TWO_FA_CHALLENGE_TTL_SECONDS,
      algorithm: 'RS256',
    });
  }

  private verifyTwoFaChallenge(token: string): TwoFaChallengePayload {
    let payload: unknown;
    try {
      payload = this.jwtService.verify(token, { algorithms: ['RS256'] });
    } catch {
      throw new UnauthorizedException('invalid_2fa_token');
    }
    const candidate = payload as Partial<TwoFaChallengePayload>;
    if (
      typeof candidate.sub !== 'string' ||
      typeof candidate.tenantId !== 'string' ||
      typeof candidate.r !== 'string' ||
      candidate.purpose !== TWO_FA_CHALLENGE_PURPOSE
    ) {
      throw new UnauthorizedException('invalid_2fa_token');
    }
    return candidate as TwoFaChallengePayload;
  }
}
