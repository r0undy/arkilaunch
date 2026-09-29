import { z } from 'zod';
import { SEC_REGEX, TIN_REGEX } from './kyc.js';
import { PaginationQuerySchema } from './pagination.js';
import { PhMobileSchema } from './phone.js';

// No password: the owner sets one from the emailed activation link, which proves they own the email.
export const TenantRegisterRequestSchema = z.object({
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  mobileNumber: PhMobileSchema,
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

export const TenantApplicationDecisionResponseSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  activationToken: z.string().optional(),
  // The owner activates on {slug}.<platform domain>, not the platform host.
  tenantSlug: z.string().optional(),
});
export type TenantApplicationDecisionResponse = z.infer<typeof TenantApplicationDecisionResponseSchema>;

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

export const TenantApplicationListQuerySchema = PaginationQuerySchema;
export type TenantApplicationListQuery = z.infer<typeof TenantApplicationListQuerySchema>;

export const TenantApplicationListResponseSchema = z.object({
  items: z.array(TenantApplicationSchema),
  total: z.number().int(),
});
export type TenantApplicationListResponse = z.infer<typeof TenantApplicationListResponseSchema>;

// Reserved labels never resolve to a tenant (arkilaunch-platform is the platform_admin's own row) and are never minted.
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
  // A decimal string to keep NUMERIC precision.
  revenuePaid: z.string(),
});
export type PlatformCompany = z.infer<typeof PlatformCompanySchema>;

export const PlatformCompanyListResponseSchema = z.object({ items: z.array(PlatformCompanySchema) });
export type PlatformCompanyListResponse = z.infer<typeof PlatformCompanyListResponseSchema>;

export const CompanyStatusUpdateRequestSchema = z.object({ status: CompanyStatusSchema }).strict();
export type CompanyStatusUpdateRequest = z.infer<typeof CompanyStatusUpdateRequestSchema>;

// legal_name and slug are never writable: .strict() makes a smuggled field a 400.
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const TenantFontSchema = z.enum(['inter', 'plex']);
export type TenantFont = z.infer<typeof TenantFontSchema>;

// Lands in an href on a public page: https Facebook hosts only, normalized to match the DB CHECK.
const FACEBOOK_HOST = /(^|\.)(facebook|fb)\.com$/;
const FacebookUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((value, ctx) => {
    let url: URL | null = null;
    try {
      url = new URL(value);
    } catch {
      // not a URL; reported below
    }
    if (!url || url.protocol !== 'https:' || !FACEBOOK_HOST.test(url.hostname) || url.port || url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'Enter your Facebook page link, starting with https://' });
      return z.NEVER;
    }
    return url.href;
  });

// Same rule for the Messenger link (DB CHECK in 0067).
const MESSENGER_HOST = /^(m\.me|(www\.)?messenger\.com|([a-z0-9-]+\.)*facebook\.com)$/;
const MessengerUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((value, ctx) => {
    let url: URL | null = null;
    try {
      url = new URL(value);
    } catch {
      // not a URL; reported below
    }
    if (!url || url.protocol !== 'https:' || !MESSENGER_HOST.test(url.hostname) || url.port || url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'Enter your Messenger link, like https://m.me/yourpage' });
      return z.NEVER;
    }
    return url.href;
  });

export const TenantBrandingUpdateRequestSchema = z
  .object({
    primaryColor: z.string().toLowerCase().regex(HEX_COLOR).nullable(),
    headerColor: z.string().toLowerCase().regex(HEX_COLOR).nullable(),
    font: TenantFontSchema.nullable(),
    facebookUrl: FacebookUrlSchema.nullable(),
    messengerUrl: MessengerUrlSchema.nullable().default(null),
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

export const TenantBrandingSchema = z.object({
  legalName: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  heroUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  headerColor: z.string().nullable(),
  font: TenantFontSchema.nullable(),
  facebookUrl: z.string().nullable(),
  messengerUrl: z.string().nullable(),
  tagline: z.string().nullable(),
  about: z.string().nullable(),
  phone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

export const CatalogTenantSchema = TenantBrandingSchema.omit({ legalName: true, slug: true }).extend({
  name: z.string(),
});
export type CatalogTenant = z.infer<typeof CatalogTenantSchema>;

export const CatalogTenantListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
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
  primaryColor: z.string().nullable(),
  categories: z.array(z.string()),
});
export type CatalogTenantListItem = z.infer<typeof CatalogTenantListItemSchema>;

export const CatalogTenantListResponseSchema = z.object({
  items: z.array(CatalogTenantListItemSchema),
  total: z.number().int(),
  categories: z.array(z.string()),
  locations: z.array(z.string()),
});
export type CatalogTenantListResponse = z.infer<typeof CatalogTenantListResponseSchema>;
