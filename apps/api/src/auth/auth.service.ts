import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from '@node-rs/argon2';
import { findUserByEmailForAuth } from '@arkilaunch/db';
import type { AuthTokens, LoginRequest, RefreshRequest } from '@arkilaunch/shared';
import { RefreshTokenService } from './refresh-token.service.js';

const ACCESS_TOKEN_TTL_SECONDS = 600; // ~10 min, RFC-1 §3

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async login({ email, password }: LoginRequest): Promise<AuthTokens> {
    const user = await findUserByEmailForAuth(email.toLowerCase());
    // Same error for bad email, bad password (RFC-1 §3): no user-enumeration signal.
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('invalid_credentials');
    }

    const passwordOk = await verify(user.passwordHash, password);
    if (!passwordOk) {
      throw new UnauthorizedException('invalid_credentials');
    }

    const accessToken = this.signAccessToken(user.tenantId, user.id, user.roleName);
    const { token: refreshToken } = await this.refreshTokens.issue(
      user.tenantId,
      user.id,
      user.roleName,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
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

  private signAccessToken(tenantId: string, userId: string, role: string): string {
    return this.jwtService.sign(
      { sub: userId, tenantId, role },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'RS256' },
    );
  }
}
