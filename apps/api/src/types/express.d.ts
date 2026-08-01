import type { JwtClaims, RequestContext } from '@arkilaunch/shared';

declare module 'express' {
  interface Request {
    user?: JwtClaims;
    ctx?: RequestContext;
  }
}
