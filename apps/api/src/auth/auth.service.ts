import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import {
  activateOnboardingTenant,
  EmailTakenError,
  findUserByEmailForAuth,
  registerCustomerUser,
  StorefrontNotFoundError,
  users,
  withTenantTx,
} from '@arkilaunch/db';
import { eq } from 'drizzle-orm';
import { notifyStaff } from '../common/notify-customer.js';
import { verifyTurnstile } from '../common/turnstile.js';
import type {
  CustomerSignup,
  AuthTokens,
  ForgotPasswordRequest,
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

// Overridable via JWT_ACCESS_TOKEN_TTL (seconds).
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.JWT_ACCESS_TOKEN_TTL) || 600;
const TWO_FA_CHALLENGE_TTL_SECONDS = 300; // 5 min
const TWO_FA_CHALLENGE_PURPOSE = '2fa_challenge';
const ACTIVATION_TOKEN_TTL_SECONDS = 72 * 60 * 60; // 72h, S19
const ACTIVATION_TOKEN_PURPOSE = 'user_activation';
// Pre-login lookup GUC role: RLS filters on tenant_id only, the role is informational.
const BOOTSTRAP_ROLE = 'system';
const TWO_FA_ENFORCED_ROLE = 'timekeeper';

// Keyed by lowercased email: login runs before any tenant context, and users.email is unique platform-wide.
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60_000;
// From this many failures (per email OR per IP) a login must carry a Turnstile token.
// ponytail: in-process per replica, like the lockout; move both to Postgres if replicas stop being a handful.
const LOGIN_CAPTCHA_THRESHOLD = 2;

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
  private readonly ipLoginAttempts = new Map<string, LoginAttemptState>();
  private readonly twoFaAttempts = new Map<string, LoginAttemptState>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
  ) {}

  // Scoped to the request host's tenant; the wrong host gets the same invalid_credentials as a bad password.
  async login(
    { email, password }: LoginRequest,
    tenantSlug: string,
    ip?: string,
    turnstileToken?: string,
  ): Promise<AuthTokens | TwoFaChallenge> {
    const normalizedEmail = email.toLowerCase();
    this.assertNotLockedOut(this.loginAttempts, normalizedEmail);
    if (
      this.failCount(this.loginAttempts, normalizedEmail) >= LOGIN_CAPTCHA_THRESHOLD ||
      (ip && this.failCount(this.ipLoginAttempts, ip) >= LOGIN_CAPTCHA_THRESHOLD)
    ) {
      await verifyTurnstile(turnstileToken, ip);
    }

    const user = await findUserByEmailForAuth(normalizedEmail, tenantSlug);
    // Same error for bad email and bad password: no user-enumeration signal.
    if (!user || user.status !== 'active') {
      this.recordLoginFailure(normalizedEmail, ip);
      throw new UnauthorizedException('invalid_credentials');
    }

    const passwordOk = await verify(user.passwordHash, password);
    if (!passwordOk) {
      this.recordLoginFailure(normalizedEmail, ip);
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
      // Not enrolled: let them in to reach the enroll endpoints. 2FA is NOT enforced anywhere else yet.
    }

    return this.issueTokens(user.tenantId, user.id, user.roleName);
  }

  // 'email_taken' does reveal an address has an account, as every signup does; login stays non-enumerating.
  async registerCustomer({ email, password }: CustomerSignup, tenantSlug: string): Promise<AuthTokens> {
    const passwordHash = await hash(password);
    try {
      const created = await registerCustomerUser(tenantSlug, email.toLowerCase(), passwordHash);
      return this.issueTokens(created.tenantId, created.userId, 'customer');
    } catch (err) {
      if (err instanceof EmailTakenError) throw new ConflictException({ error: 'email_taken' });
      if (err instanceof StorefrontNotFoundError) throw new NotFoundException({ error: 'tenant_not_found' });
      throw err;
    }
  }

  // Only tells the tenant's admins, who reset it; the same answer for every email, so nothing is revealed.
  async forgotPassword({ email }: ForgotPasswordRequest, tenantSlug: string): Promise<{ ok: true }> {
    const normalizedEmail = email.toLowerCase();
    const user = await findUserByEmailForAuth(normalizedEmail, tenantSlug);
    if (user && user.status === 'active') {
      await withTenantTx({ tenantId: user.tenantId, userId: user.id, role: BOOTSTRAP_ROLE }, (tx) =>
        notifyStaff(tx, user.tenantId, 'password_reset_requested', { email: normalizedEmail, user_id: user.id }),
      );
    }
    return { ok: true };
  }

  async verifyTwoFa({ twoFaToken, code }: Verify2faRequest): Promise<AuthTokens> {
    const payload = this.verifyTwoFaChallenge(twoFaToken);
    // Keyed by user, not IP: a fresh login mints a fresh challenge, so only a per-account count bounds guessing.
    this.assertNotLockedOut(this.twoFaAttempts, payload.sub);
    // Counted before any await, so parallel guesses can't all pass the check; a correct code clears it.
    this.bump(this.twoFaAttempts, payload.sub);
    const secret = await this.getTotpSecret(payload.tenantId, payload.sub, payload.r);
    if (!secret || !(await this.totp.verify(code, secret))) {
      throw new UnauthorizedException('invalid_totp_code');
    }
    this.twoFaAttempts.delete(payload.sub);
    return this.issueTokens(payload.tenantId, payload.sub, payload.r);
  }

  // Not persisted until enrollConfirm proves a valid code, so a garbled QR scan can't lock a timekeeper out.
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

  // Single use: the token is bound to the invited user's password hash, which activation changes.
  async activate({ activationToken, password }: UserActivateRequest): Promise<void> {
    // @Public: tenant context comes from the activation token's signed claims; RLS still runs on a real GUC.
    const payload = this.verifyActivationToken(activationToken);

    await withTenantTx({ tenantId: payload.tenantId, userId: payload.sub, role: BOOTSTRAP_ROLE }, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, payload.sub)).limit(1);
      if (!user || user.status !== 'invited') {
        throw new UnauthorizedException('invalid_activation_token');
      }
      if (this.hashForActivation(user.passwordHash) !== payload.pwv) {
        // Already activated or re-invited since issue: dead either way.
        throw new UnauthorizedException('invalid_activation_token');
      }

      const passwordHash = await hash(password);
      await tx.update(users).set({ passwordHash, status: 'active' }).where(eq(users.id, payload.sub));
    });
    // A self-registered company goes live when its owner activates.
    await activateOnboardingTenant(payload.tenantId);
  }

  // Bound to the CURRENT password hash: activation and re-invite both invalidate outstanding tokens.
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

  // Rejects before password verification, so a locked-out attempt never costs an argon2 hash.
  private assertNotLockedOut(attempts: Map<string, LoginAttemptState>, key: string): void {
    const state = attempts.get(key);
    if (!state) return;
    const elapsedMs = Date.now() - state.windowStart;
    if (elapsedMs > LOGIN_LOCKOUT_WINDOW_MS) {
      attempts.delete(key);
      return;
    }
    if (state.failCount >= LOGIN_LOCKOUT_THRESHOLD) {
      throw new HttpException(
        { error: 'login_locked', retryAfterSeconds: Math.ceil((LOGIN_LOCKOUT_WINDOW_MS - elapsedMs) / 1000) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordLoginFailure(email: string, ip: string | undefined): void {
    this.bump(this.loginAttempts, email);
    if (ip) this.bump(this.ipLoginAttempts, ip);
  }

  private bump(attempts: Map<string, LoginAttemptState>, key: string): void {
    const now = Date.now();
    const state = attempts.get(key);
    if (!state || now - state.windowStart > LOGIN_LOCKOUT_WINDOW_MS) {
      attempts.set(key, { failCount: 1, windowStart: now });
    } else {
      state.failCount += 1;
    }
  }

  private failCount(attempts: Map<string, LoginAttemptState>, key: string): number {
    const state = attempts.get(key);
    return state && Date.now() - state.windowStart <= LOGIN_LOCKOUT_WINDOW_MS ? state.failCount : 0;
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

  // Deliberately not JwtClaimsSchema-shaped (the `r` key and `purpose` marker), so this challenge can never
  // pass as a Bearer token on a guarded route.
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
