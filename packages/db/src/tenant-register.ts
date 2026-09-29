import { sql } from 'drizzle-orm';
import { db } from './client.js';
import { pgError } from './pg-error.js';

// No tenant context yet for an unauthenticated registrant: goes through a narrow SECURITY DEFINER function.

export interface TenantRegisterInput {
  legalName: string;
  slug: string;
  ownerEmail: string;
  placeholderPasswordHash: string;
  companyName: string;
  businessAddress: string;
  secNumber: string;
  tin: string;
  contactFirstName: string;
  contactLastName: string;
  contactMobile: string;
  contactJobTitle: string;
}

export interface TenantRegisterResult {
  tenantId: string;
  ownerUserId: string;
  applicationId: string;
}

export class DuplicatePendingApplicationError extends Error {}

export async function registerTenant(input: TenantRegisterInput): Promise<TenantRegisterResult> {
  try {
    const rows = await db.execute<{ tenant_id: string; owner_user_id: string; application_id: string }>(
      sql`select * from tenants_register(
        ${input.legalName}, ${input.slug}, ${input.ownerEmail}, ${input.placeholderPasswordHash},
        ${input.companyName}, ${input.businessAddress}, ${input.secNumber}, ${input.tin},
        ${input.contactFirstName}, ${input.contactLastName}, ${input.contactMobile}, ${input.contactJobTitle}
      )`,
    );
    const row = rows[0];
    if (!row) throw new Error('tenants_register returned no row');
    return { tenantId: row.tenant_id, ownerUserId: row.owner_user_id, applicationId: row.application_id };
  } catch (err) {
    if (isDuplicatePendingApplication(err)) throw new DuplicatePendingApplicationError('duplicate_pending_application');
    if (isEmailTaken(err)) throw new EmailTakenError('email_taken');
    throw err;
  }
}

export interface TenantApplicationDecisionResult {
  tenantId: string;
  ownerUserId: string | null;
  passwordHash: string | null;
  tenantSlug: string;
}

// Cross-tenant (platform_admin only): SECURITY DEFINER because the caller decides another tenant's application.
export class ApplicationNotPendingError extends Error {}

export async function decideTenantApplication(
  applicationId: string,
  decision: 'approved' | 'rejected',
  reviewerUserId: string,
): Promise<TenantApplicationDecisionResult> {
  try {
    const rows = await db.execute<{
      tenant_id: string;
      owner_user_id: string | null;
      password_hash: string | null;
      tenant_slug: string;
    }>(
      sql`select * from tenants_decide_application(${applicationId}, ${decision}, ${reviewerUserId})`,
    );
    const row = rows[0];
    if (!row) throw new Error('tenants_decide_application returned no row');
    return {
      tenantId: row.tenant_id,
      ownerUserId: row.owner_user_id,
      passwordHash: row.password_hash,
      tenantSlug: row.tenant_slug,
    };
  } catch (err) {
    if (isApplicationNotPending(err)) throw new ApplicationNotPendingError('application_not_pending');
    throw err;
  }
}

export interface PendingTenantApplication {
  applicationId: string;
  tenantId: string;
  companyName: string;
  contactFirstName: string;
  contactLastName: string;
  contactMobile: string;
  contactJobTitle: string;
  createdAt: Date;
}

// Cross-tenant read (platform_admin only), paged at the database around the SECURITY DEFINER function.
export async function countPendingTenantApplications(): Promise<number> {
  const [row] = await db.execute<{ total: string }>(
    sql`select count(*)::text as total from tenants_list_pending_applications()`,
  );
  return Number(row?.total ?? 0);
}

export async function listPendingTenantApplications(
  limit: number,
  offset: number,
): Promise<PendingTenantApplication[]> {
  const rows = await db.execute<{
    application_id: string;
    tenant_id: string;
    company_name: string;
    contact_first_name: string;
    contact_last_name: string;
    contact_mobile: string;
    contact_job_title: string;
    created_at: string;
  }>(sql`select * from tenants_list_pending_applications() limit ${limit} offset ${offset}`);
  return rows.map((row) => ({
    applicationId: row.application_id,
    tenantId: row.tenant_id,
    companyName: row.company_name,
    contactFirstName: row.contact_first_name,
    contactLastName: row.contact_last_name,
    contactMobile: row.contact_mobile,
    contactJobTitle: row.contact_job_title,
    createdAt: new Date(row.created_at),
  }));
}

function isApplicationNotPending(err: unknown): boolean {
  return /application_not_pending/.test(String(pgError(err).message));
}

function isDuplicatePendingApplication(err: unknown): boolean {
  const e = pgError(err);
  return e.code === '23505' && typeof e.message === 'string' && e.message.includes('duplicate_pending_application');
}

export class EmailTakenError extends Error {}

// The functions' own 'email_taken', or the one-login-per-email index on a concurrent race.
function isEmailTaken(err: unknown): boolean {
  const e = pgError(err);
  return /email_taken/.test(String(e.message)) || e.constraint === 'users_email_key_uq';
}
export class StorefrontNotFoundError extends Error {}

// Pre-tenant-context write; customer_register only accepts an active tenant.
export async function registerCustomerUser(
  tenantSlug: string,
  email: string,
  passwordHash: string,
): Promise<{ tenantId: string; userId: string }> {
  try {
    const rows = await db.execute<{ tenant_id: string; user_id: string }>(
      sql`select * from customer_register(${tenantSlug}, ${email}, ${passwordHash})`,
    );
    const row = rows[0];
    if (!row) throw new Error('customer_register returned no row');
    return { tenantId: row.tenant_id, userId: row.user_id };
  } catch (err) {
    if (isEmailTaken(err)) throw new EmailTakenError('email_taken');
    if (/storefront_tenant_not_found/.test(String(pgError(err).message))) throw new StorefrontNotFoundError('tenant_not_found');
    throw err;
  }
}

// Cross-tenant (platform admin); aggregate counts only.
export interface PlatformCompanyRow {
  tenantId: string;
  legalName: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: Date;
  usersCount: number;
  customersCount: number;
  equipmentCount: number;
  rentalsCount: number;
  revenuePaid: string;
}

export async function listPlatformCompanies(): Promise<PlatformCompanyRow[]> {
  const rows = await db.execute<{
    tenant_id: string;
    legal_name: string;
    slug: string;
    status: 'active' | 'suspended';
    created_at: string;
    users_count: string;
    customers_count: string;
    equipment_count: string;
    rentals_count: string;
    revenue_paid: string;
  }>(sql`select * from tenants_list_companies()`);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    legalName: r.legal_name,
    slug: r.slug,
    status: r.status,
    createdAt: new Date(r.created_at),
    usersCount: Number(r.users_count),
    customersCount: Number(r.customers_count),
    equipmentCount: Number(r.equipment_count),
    rentalsCount: Number(r.rentals_count),
    revenuePaid: String(r.revenue_paid),
  }));
}

export class CompanyNotFoundError extends Error {}

export async function setPlatformCompanyStatus(
  tenantId: string,
  status: 'active' | 'suspended',
  actorUserId: string,
): Promise<void> {
  try {
    await db.execute(sql`select * from tenants_set_status(${tenantId}, ${status}, ${actorUserId})`);
  } catch (err) {
    rethrowCompanyNotFound(err);
  }
}

// An auto-approved tenant goes live when its invited owner sets a password; else a no-op.
export async function activateOnboardingTenant(tenantId: string): Promise<void> {
  await db.execute(sql`select tenants_activate_onboarding(${tenantId})`);
}

// The caller decides the tenant: the JWT's tenant for owner/admin, or a platform admin's pick.
// The functions never touch legal_name, slug or status and refuse the platform tenant.
export interface TenantBrandingInput {
  primaryColor: string | null;
  headerColor: string | null;
  font: string | null;
  facebookUrl: string | null;
  messengerUrl: string | null;
  tagline: string | null;
  about: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
}

function rethrowCompanyNotFound(err: unknown): never {
  if (/company_not_found/.test(String(pgError(err).message))) {
    throw new CompanyNotFoundError('company_not_found');
  }
  throw err;
}

export async function updateTenantBranding(
  tenantId: string,
  actorUserId: string,
  b: TenantBrandingInput,
): Promise<void> {
  try {
    await db.execute(
      sql`select tenants_update_branding(${tenantId}, ${actorUserId}, ${b.primaryColor}, ${b.headerColor}, ${b.font},
        ${b.tagline}, ${b.about}, ${b.phone}, ${b.contactEmail}, ${b.address}, ${b.city}, ${b.province}, ${b.facebookUrl}, ${b.messengerUrl})`,
    );
  } catch (err) {
    rethrowCompanyNotFound(err);
  }
}

export async function setTenantBrandingImage(
  tenantId: string,
  actorUserId: string,
  kind: 'logo' | 'hero' | 'icon',
  key: string | null,
): Promise<void> {
  try {
    await db.execute(sql`select tenants_set_branding_image(${tenantId}, ${actorUserId}, ${kind}, ${key})`);
  } catch (err) {
    rethrowCompanyNotFound(err);
  }
}

// NULL unlinks it; that company is cash-only again.
export async function setTenantPaymongoAccount(
  tenantId: string,
  actorUserId: string,
  accountId: string | null,
): Promise<void> {
  try {
    await db.execute(sql`select tenants_set_paymongo_account(${tenantId}, ${actorUserId}, ${accountId})`);
  } catch (err) {
    rethrowCompanyNotFound(err);
  }
}

// The caller passes the verified JWT's tenant.
export async function getTenantTin(tenantId: string): Promise<string | null> {
  const rows = await db.execute<{ tin: string | null }>(sql`select tenants_get_tin(${tenantId}) as tin`);
  return rows[0]?.tin ?? null;
}

export async function getTenantPaymongoAccount(tenantId: string): Promise<string | null> {
  const rows = await db.execute<{ id: string | null }>(sql`select tenants_get_paymongo_account(${tenantId}) as id`);
  return rows[0]?.id ?? null;
}

export async function getTenantBranding(
  tenantId: string,
): Promise<
  | (TenantBrandingInput & {
      legalName: string;
      slug: string;
      logoKey: string | null;
      heroKey: string | null;
      iconKey: string | null;
    })
  | null
> {
  const rows = await db.execute<{
    legal_name: string;
    slug: string;
    logo_key: string | null;
    hero_key: string | null;
    icon_key: string | null;
    primary_color: string | null;
    header_color: string | null;
    font: string | null;
    facebook_url: string | null;
    messenger_url: string | null;
    tagline: string | null;
    about: string | null;
    phone: string | null;
    contact_email: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
  }>(sql`select * from tenants_get_branding(${tenantId})`);
  const r = rows[0];
  if (!r) return null;
  return {
    legalName: r.legal_name,
    slug: r.slug,
    logoKey: r.logo_key,
    heroKey: r.hero_key,
    iconKey: r.icon_key,
    primaryColor: r.primary_color,
    headerColor: r.header_color,
    font: r.font,
    facebookUrl: r.facebook_url,
    messengerUrl: r.messenger_url,
    tagline: r.tagline,
    about: r.about,
    phone: r.phone,
    contactEmail: r.contact_email,
    address: r.address,
    city: r.city,
    province: r.province,
  };
}
