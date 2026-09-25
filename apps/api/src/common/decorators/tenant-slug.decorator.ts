import { createParamDecorator, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { isTenantSlug, PLATFORM_TENANT_SLUG } from '@arkilaunch/shared';
import type { Request } from 'express';

// The tenant label of the host the request came from (apps/web lib/host.ts
// sends it as X-Tenant-Slug). It only ever picks WHICH tenant a public read
// or a login/signup targets; it never grants access and never reaches
// req.ctx -- authenticated data is scoped by the JWT alone (RFC-1).
function readSlug(ctx: ExecutionContext): string | null {
  const raw = ctx.switchToHttp().getRequest<Request>().header('x-tenant-slug');
  if (raw === undefined || raw === '') return null;
  const slug = raw.toLowerCase();
  if (!isTenantSlug(slug)) throw new NotFoundException({ error: 'tenant_not_found' });
  return slug;
}

// Storefront endpoints: a tenant host is required.
export const StorefrontSlug = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const slug = readSlug(ctx);
  if (!slug) throw new NotFoundException({ error: 'tenant_not_found' });
  return slug;
});

// Login-style endpoints: a tenant host scopes to that tenant, the platform
// host (no header) scopes to the platform_admin's own tenant.
export const LoginTenantSlug = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => readSlug(ctx) ?? PLATFORM_TENANT_SLUG,
);
