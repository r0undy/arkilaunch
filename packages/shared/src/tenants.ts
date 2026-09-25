import { z } from 'zod';
import { SEC_REGEX, TIN_REGEX } from './kyc.js';
import { PaginationQuerySchema } from './pagination.js';

// POST /tenants/register (@Public, backend-unblock plan workstream 1).
// Mirrors apps/web/src/lib/registration-client.ts's PersonalDetails +
// CompanyDetails two-step form. No `password` field: the owner sets their
// own password later through the proven POST /auth/activate flow once an
// admin approves the application (there is no platform-console approval UI
// yet, see the Change Record) -- storing a self-chosen password for an
// unapproved account would be new, unaudited state.
export const TenantRegisterRequestSchema = z.object({
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  mobileNumber: z.string().min(1).max(50),
  email: z.string().email(),
  jobTitle: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  businessAddress: z.string().min(1).max(500),
  secNumber: z.string().regex(SEC_REGEX),
  tin: z.string().regex(TIN_REGEX),
});
export type TenantRegisterRequest = z.infer<typeof TenantRegisterRequestSchema>;

export const TenantRegisterResponseSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.literal('pending'),
});
export type TenantRegisterResponse = z.infer<typeof TenantRegisterResponseSchema>;

// POST /tenants/:id/approve | /reject (tenant:approve, platform_admin only).
// No platform-console UI exists yet (S3/S25 deferred) -- this is an
// API/curl-level step for now, logged honestly in the Change Record.
export const TenantApplicationDecisionResponseSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  // Present only on approve: relayed out-of-band by the platform admin to
  // the new owner, exactly like a user invite (no email provider in the
  // pinned stack).
  activationToken: z.string().optional(),
  // The approved tenant's host label, so the console builds the activation
  // link on `{slug}.<platform domain>` -- the owner signs in there, not on
  // the platform host.
  tenantSlug: z.string().optional(),
});
export type TenantApplicationDecisionResponse = z.infer<typeof TenantApplicationDecisionResponseSchema>;

// GET /tenants/applications (tenant:approve, platform_admin only) --
// the platform-console list this pass unblocks. GET /tenants/me/application
// (tenant:manage) reuses the same item shape for an owner's own tenant.
export const TenantApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  companyName: z.string(),
  contactFirstName: z.string(),
  contactLastName: z.string(),
  contactMobile: z.string(),
  contactJobTitle: z.string(),
  createdAt: z.coerce.date(),
});
export type TenantApplication = z.infer<typeof TenantApplicationSchema>;

// The platform queue is cross-tenant and was returning every pending
// application in one unbounded response while ignoring the ?limit=&offset=
// app.companies.tsx sends (audit-api-surface.md #4).
export const TenantApplicationListQuerySchema = PaginationQuerySchema;
export type TenantApplicationListQuery = z.infer<typeof TenantApplicationListQuerySchema>;

export const TenantApplicationListResponseSchema = z.object({
  items: z.array(TenantApplicationSchema),
  total: z.number().int(),
});
export type TenantApplicationListResponse = z.infer<typeof TenantApplicationListResponseSchema>;

// GET /tenants/applications/approved (tenant:approve, platform_admin only).
export const ApprovedTenantApplicationSchema = TenantApplicationSchema.extend({
  reviewedAt: z.coerce.date().nullable(),
});
export type ApprovedTenantApplication = z.infer<typeof ApprovedTenantApplicationSchema>;

export const ApprovedTenantApplicationListResponseSchema = z.object({
  items: z.array(ApprovedTenantApplicationSchema),
  total: z.number().int(),
});
export type ApprovedTenantApplicationListResponse = z.infer<
  typeof ApprovedTenantApplicationListResponseSchema
>;

// Host-based tenant resolution: `{slug}.localhost` / `{slug}.arkilaunch.tech`
// is a tenant, the bare domain is the ArkiLaunch platform. A slug is one DNS
// label, so it is capped at 63 chars. Reserved labels never resolve to a
// tenant -- `arkilaunch-platform` is the platform_admin's own tenant row
// (seed/anchor.ts), not a storefront -- and registration never mints them.
export const TENANT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'admin',
  'api',
  'app',
  'arkilaunch',
  'arkilaunch-platform',
]);
export const PLATFORM_TENANT_SLUG = 'arkilaunch-platform';

export function isTenantSlug(value: string): boolean {
  return TENANT_SLUG_REGEX.test(value) && !RESERVED_TENANT_SLUGS.has(value);
}
