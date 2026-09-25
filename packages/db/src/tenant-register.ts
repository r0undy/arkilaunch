import { sql } from 'drizzle-orm';
import { db } from './client.js';

// Pre-tenant-context write for POST /tenants/register only (see
// migrations/0009_tenant_registration.sql). Calls a narrow SECURITY DEFINER
// function, not an RLS-protected table directly -- there is no tenant
// context yet for an unauthenticated caller creating a tenant for the
// first time, same rationale as auth-lookup.ts.

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
    throw err;
  }
}

export interface TenantApplicationDecisionResult {
  tenantId: string;
  ownerUserId: string | null;
  passwordHash: string | null;
  tenantSlug: string;
}

// Cross-tenant administrative write for POST /tenants/:id/approve|/reject
// (tenant:approve, platform_admin only). See migrations/0009_tenant_registration.sql
// tenants_decide_application() for why this bypasses withTenantTx's normal
// RLS scoping -- the caller is authenticated and permission-checked, but is
// deciding on a DIFFERENT tenant's application than their own.
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

// Cross-tenant administrative read for GET /tenants/applications
// (tenant:approve, platform_admin only) -- same rationale as
// decideTenantApplication, but for the list a platform console needs before
// it can call approve/reject at all.
// Paged at the database rather than in Node. The SECURITY DEFINER
// function itself is unchanged -- LIMIT/OFFSET wrap its result set, so
// Postgres stops shipping rows past the page, and the platform queue no
// longer returns every pending application in one response
// (audit-api-surface.md #4). `total` is a separate count over the same
// function so a caller can page.
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
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: string }).message === 'string' &&
    (err as { message: string }).message.includes('application_not_pending')
  );
}

function isDuplicatePendingApplication(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505' &&
    'message' in err &&
    typeof (err as { message: string }).message === 'string' &&
    (err as { message: string }).message.includes('duplicate_pending_application')
  );
}

export class EmailTakenError extends Error {}
export class StorefrontNotFoundError extends Error {}

// Pre-tenant-context write for POST /auth/register-customer (migration
// 0023, active-tenant check added in 0048). The slug is the request host's
// tenant label; customer_register only accepts an active tenant.
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
    // Drizzle wraps the Postgres error; its RAISE message is on `cause`.
    const e = err as { message?: unknown; cause?: { message?: unknown } };
    const text = `${String(e?.message)} ${String(e?.cause?.message)}`;
    if (/email_taken/.test(text)) throw new EmailTakenError('email_taken');
    if (/storefront_tenant_not_found/.test(text)) throw new StorefrontNotFoundError('tenant_not_found');
    throw err;
  }
}

// Cross-tenant administrative read/write for the /admin Companies page
// (migration 0049). Aggregate counts only; see tenants_list_companies().
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
    const e = err as { message?: unknown; cause?: { message?: unknown } };
    if (/company_not_found/.test(`${String(e?.message)} ${String(e?.cause?.message)}`)) {
      throw new CompanyNotFoundError('company_not_found');
    }
    throw err;
  }
}

// POST /auth/activate: an auto-approved tenant goes live when its invited
// owner sets a password (migration 0051). A no-op for any other tenant.
export async function activateOnboardingTenant(tenantId: string): Promise<void> {
  await db.execute(sql`select tenants_activate_onboarding(${tenantId})`);
}

// Tenant branding writes (migration 0051). The caller decides the tenant:
// the verified JWT's tenant for owner/admin, or a platform admin's chosen
// company. The functions never touch legal_name, slug or status and refuse
// the platform tenant.
export interface TenantBrandingInput {
  primaryColor: string | null;
  tagline: string | null;
  about: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
}

function rethrowCompanyNotFound(err: unknown): never {
  const e = err as { message?: unknown; cause?: { message?: unknown } };
  if (/company_not_found/.test(`${String(e?.message)} ${String(e?.cause?.message)}`)) {
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
      sql`select tenants_update_branding(${tenantId}, ${actorUserId}, ${b.primaryColor}, ${b.tagline}, ${b.about},
        ${b.phone}, ${b.contactEmail}, ${b.address}, ${b.city}, ${b.province})`,
    );
  } catch (err) {
    rethrowCompanyNotFound(err);
  }
}

export async function setTenantBrandingImage(
  tenantId: string,
  actorUserId: string,
  kind: 'logo' | 'hero',
  key: string | null,
): Promise<void> {
  try {
    await db.execute(sql`select tenants_set_branding_image(${tenantId}, ${actorUserId}, ${kind}, ${key})`);
  } catch (err) {
    rethrowCompanyNotFound(err);
  }
}

// The branding form's current values for any tenant (owner/admin reads its
// own; platform admin reads the company it is editing).
export async function getTenantBranding(
  tenantId: string,
): Promise<(TenantBrandingInput & { legalName: string; slug: string; logoKey: string | null; heroKey: string | null }) | null> {
  const rows = await db.execute<{
    legal_name: string;
    slug: string;
    logo_key: string | null;
    hero_key: string | null;
    primary_color: string | null;
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
    primaryColor: r.primary_color,
    tagline: r.tagline,
    about: r.about,
    phone: r.phone,
    contactEmail: r.contact_email,
    address: r.address,
    city: r.city,
    province: r.province,
  };
}
