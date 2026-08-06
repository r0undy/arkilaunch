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
    const rows = await db.execute<{ tenant_id: string; owner_user_id: string | null; password_hash: string | null }>(
      sql`select * from tenants_decide_application(${applicationId}, ${decision}, ${reviewerUserId})`,
    );
    const row = rows[0];
    if (!row) throw new Error('tenants_decide_application returned no row');
    return { tenantId: row.tenant_id, ownerUserId: row.owner_user_id, passwordHash: row.password_hash };
  } catch (err) {
    if (isApplicationNotPending(err)) throw new ApplicationNotPendingError('application_not_pending');
    throw err;
  }
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
