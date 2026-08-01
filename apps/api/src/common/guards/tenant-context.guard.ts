import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextSchema, type JwtClaims } from '@arkilaunch/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

// Populates request.ctx from the already-verified JWT claims (JwtAuthGuard
// runs first). tenant_id NEVER comes from a header, query param, or body --
// only from here (AGENTS.md "Never": trust a client-supplied tenant_id).
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtClaims; ctx?: unknown }>();
    if (!req.user) return false;

    req.ctx = RequestContextSchema.parse({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      role: req.user.role,
    });
    return true;
  }
}
