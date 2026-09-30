import { createParamDecorator, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { isTenantSlug, PLATFORM_TENANT_SLUG } from '@arkilaunch/shared';
import type { Request } from 'express';

// Only picks WHICH tenant a public read or login targets; never grants access or reaches req.ctx (the JWT scopes data).
function readSlug(ctx: ExecutionContext): string | null {
  const raw = ctx.switchToHttp().getRequest<Request>().header('x-tenant-slug');
  if (raw === undefined || raw === '') return null;
  const slug = raw.toLowerCase();
  if (!isTenantSlug(slug)) throw new NotFoundException({ error: 'tenant_not_found' });
  return slug;
}

export const StorefrontSlug = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const slug = readSlug(ctx);
  if (!slug) throw new NotFoundException({ error: 'tenant_not_found' });
  return slug;
});

// The platform host (no header) scopes to the platform_admin's own tenant.
export const LoginTenantSlug = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => readSlug(ctx) ?? PLATFORM_TENANT_SLUG,
);
