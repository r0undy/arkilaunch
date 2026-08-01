import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from '@node-rs/argon2';
import { findUserByEmailForAuth, users, withTenantTx } from '@arkilaunch/db';
import { eq } from 'drizzle-orm';
import type {
  AuthTokens,
  Enroll2faConfirmRequest,
  LoginRequest,
  RefreshRequest,
  RequestContext,
  TwoFaChallenge,
  Verify2faRequest,
} from '@arkilaunch/shared';
import { RefreshTokenService } from './refresh-token.service.js';
import { TotpService } from './totp.service.js';

const ACCESS_TOKEN_TTL_SECONDS = 600; // ~10 min, RFC-1 §3
const TWO_FA_CHALLENGE_TTL_SECONDS = 300; // 5 min
const TWO_FA_CHALLENGE_PURPOSE = '2fa_challenge';
// Only the timekeeper role is gated behind 2FA (PRD US-02, US-07); other
// roles are unaffected by this slice.
const TWO_FA_ENFORCED_ROLE = 'timekeeper';

interface TwoFaChallengePayload {
  sub: string;
  tenantId: string;
  r: string; // deliberately not `role`: see the comment on signTwoFaChallenge
  purpose: typeof TWO_FA_CHALLENGE_PURPOSE;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
  ) {}

  async login({ email, password }: LoginRequest): Promise<AuthTokens | TwoFaChallenge> {
    const user = await findUserByEmailForAuth(email.toLowerCase());
    // Same error for bad email, bad password (RFC-1 §3): no user-enumeration signal.
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('invalid_credentials');
    }

    const passwordOk = await verify(user.passwordHash, password);
    if (!passwordOk) {
      throw new UnauthorizedException('invalid_credentials');
    }

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
