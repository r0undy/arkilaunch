import { z } from 'zod';
import { SEC_REGEX, TIN_REGEX } from './kyc.js';
import { PaginationQuerySchema } from './pagination.js';

// POST /tenants/register (@Public). Mirrors apps/web/src/lib/registration-
// client.ts's two-step form. Auto-approved (CR: tenant-self-serve-branding):
// no `password` field, the owner sets one through POST /auth/activate from
// the emailed link, which is what proves they own the email.
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
  status: z.literal('approved'),
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

// GET /tenants/companies (tenant:approve, platform_admin only): every rental
// company past review, with headline counts (migration 0049).
export const CompanyStatusSchema = z.enum(['active', 'suspended']);
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;

export const PlatformCompanySchema = z.object({
  tenantId: z.string().uuid(),
  legalName: z.string(),
  slug: z.string(),
  status: CompanyStatusSchema,
  createdAt: z.coerce.date(),
  usersCount: z.number().int(),
  customersCount: z.number().int(),
  equipmentCount: z.number().int(),
  rentalsCount: z.number().int(),
  // PHP, paid payments only; a decimal string to keep NUMERIC precision.
  revenuePaid: z.string(),
});
export type PlatformCompany = z.infer<typeof PlatformCompanySchema>;

export const PlatformCompanyListResponseSchema = z.object({ items: z.array(PlatformCompanySchema) });
export type PlatformCompanyListResponse = z.infer<typeof PlatformCompanyListResponseSchema>;

// PATCH /tenants/:id/status (tenant:approve). 'suspended' is shown as
// "Inactive": its people cannot sign in and its storefront goes offline.
export const CompanyStatusUpdateRequestSchema = z.object({ status: CompanyStatusSchema }).strict();
export type CompanyStatusUpdateRequest = z.infer<typeof CompanyStatusUpdateRequestSchema>;

// Tenant branding (migration 0051). legal_name and slug are shown but never
// writable: .strict() makes a smuggled legalName/slug/status a 400.
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const TenantBrandingUpdateRequestSchema = z
  .object({
    primaryColor: z.string().toLowerCase().regex(HEX_COLOR).nullable(),
    tagline: z.string().trim().min(1).max(160),
    about: optionalText(2000),
    phone: optionalText(50),
    contactEmail: z.string().email().max(200).nullable(),
    address: optionalText(500),
    city: optionalText(100),
    province: optionalText(100),
  })
  .strict();
export type TenantBrandingUpdateRequest = z.infer<typeof TenantBrandingUpdateRequestSchema>;

// GET /tenants/me/branding, GET /tenants/:id/branding: the form's values.
export const TenantBrandingSchema = z.object({
  legalName: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  heroUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  tagline: z.string().nullable(),
  about: z.string().nullable(),
  phone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

// GET /catalog/tenant (@Public): the host tenant's public branding.
export const CatalogTenantSchema = TenantBrandingSchema.omit({ legalName: true, slug: true }).extend({
  name: z.string(),
});
export type CatalogTenant = z.infer<typeof CatalogTenantSchema>;

// GET /catalog/tenants (@Public): the platform directory.
export const CatalogTenantListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  // Matches city or province.
  location: z.string().trim().max(100).optional(),
});
export type CatalogTenantListQuery = z.infer<typeof CatalogTenantListQuerySchema>;

export const CatalogTenantListItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  tagline: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
});
export type CatalogTenantListItem = z.infer<typeof CatalogTenantListItemSchema>;

export const CatalogTenantListResponseSchema = z.object({
  items: z.array(CatalogTenantListItemSchema),
  // Filter options: equipment types listed companies rent out.
  categories: z.array(z.string()),
});
export type CatalogTenantListResponse = z.infer<typeof CatalogTenantListResponseSchema>;
