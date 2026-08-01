import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtClaims, JwtClaimsSchema } from '@arkilaunch/shared';

// RS256 with an explicit algorithm allowlist (RFC-1 §3): alg:none and
// algorithm-confusion attempts (e.g. HS256 signed with the public key) are
// rejected by construction, not by convention.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const publicKey = process.env.JWT_PUBLIC_KEY;
    if (!publicKey) throw new Error('JWT_PUBLIC_KEY is required');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: publicKey.replace(/\\n/g, '\n'),
      algorithms: ['RS256'],
      ignoreExpiration: false,
    });
  }

  validate(payload: unknown): JwtClaims {
    // Re-validate the decoded payload shape; a syntactically valid JWT does
    // not guarantee our claim contract.
    return JwtClaimsSchema.parse(payload);
  }
}
