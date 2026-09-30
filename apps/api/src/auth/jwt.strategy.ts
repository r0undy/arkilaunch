import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtClaims, JwtClaimsSchema } from '@arkilaunch/shared';

// Explicit RS256 allowlist: alg:none and algorithm confusion are rejected by construction.
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
    // A syntactically valid JWT doesn't guarantee our claim contract.
    return JwtClaimsSchema.parse(payload);
  }
}
