import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { desc, eq } from 'drizzle-orm';
import {
  ApplicationNotPendingError,
  DuplicatePendingApplicationError,
  auditLogs,
  decideTenantApplication,
  listPendingTenantApplications,
  registerTenant,
  tenantApplications,
  tenants,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  RequestContext,
  TenantApplication,
  TenantApplicationDecisionResponse,
  TenantApplicationListResponse,
  TenantRegisterRequest,
  TenantRegisterResponse,
  TenantSettingsUpdateRequest,
} from '@arkilaunch/shared';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class TenantsService {
  constructor(private readonly auth: AuthService) {}
  async me(ctx: RequestContext) {
    const [tenant] = await withTenantTx(ctx, (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)),
    );
    return tenant;
  }

  // PATCH /tenants/me (S18). legalName is the only writable field: `slug`
  // (public identity), `status`, and `kycState` are deliberately absent
  // from TenantSettingsUpdateRequestSchema (.strict(), so a smuggled field
  // is a 400) -- a tenant admin flipping their own status/kycState would
  // walk straight past the PRD-F6 human KYC verification gate. Migration
  // 0007 also revokes the column-level UPDATE privilege for every column
  // but legal_name, so this is enforced twice.
  async updateSettings(ctx: RequestContext, input: TenantSettingsUpdateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
      if (!existing) throw new NotFoundException({ error: 'tenant_not_found' });

      const [updated] = await tx
        .update(tenants)
        .set({ legalName: input.legalName })
        .where(eq(tenants.id, ctx.tenantId))
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'tenants',
        entityId: ctx.tenantId,
      });

      return updated;
    });
  }

  // GET /tenants/applications (tenant:approve, platform_admin only). Cross-
  // tenant by nature, same rationale as decideApplication -- see
  // tenants_list_pending_applications() in migrations/0011.
  async listApplications(): Promise<TenantApplicationListResponse> {
    const items = await listPendingTenantApplications();
    return { items, total: items.length };
  }

  // GET /tenants/me/application (tenant:manage). An owner's own pending
  // application, if any -- same-tenant, so this is a normal RLS-scoped read,
  // not the cross-tenant SECURITY DEFINER path listApplications() uses.
  async myApplication(ctx: RequestContext): Promise<TenantApplication | null> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(tenantApplications)
        .where(eq(tenantApplications.tenantId, ctx.tenantId))
        .orderBy(desc(tenantApplications.createdAt))
        .limit(1);
      if (!row) return null;
      return {
        applicationId: row.id,
        tenantId: row.tenantId,
        companyName: row.companyName,
        contactFirstName: row.contactFirstName,
        contactLastName: row.contactLastName,
        contactMobile: row.contactMobile,
        contactJobTitle: row.contactJobTitle,
        createdAt: row.createdAt,
      };
    });
  }

  // POST /tenants/register (@Public). No JWT, so no tenant context -- see
  // registerTenant()/tenants_register() for why this is a SECURITY DEFINER
  // write rather than a withTenantTx call. The owner user is created
  // status='invited' with an unusable random password hash (never a
  // caller-chosen password); it can only log in once an admin approves and
  // the owner completes POST /auth/activate, mirroring the invite flow
  // exactly. Slug is derived from the company name with a numeric suffix on
  // collision, since tenants.slug is UNIQUE.
  async register(input: TenantRegisterRequest): Promise<TenantRegisterResponse> {
    const baseSlug = slugify(input.companyName);
    const placeholderHash = await hash(randomBytes(32).toString('hex'));

    let attempt = 0;
    while (attempt < 5) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`;
      try {
        const result = await registerTenant({
          legalName: input.companyName,
          slug,
          ownerEmail: input.email,
          placeholderPasswordHash: placeholderHash,
          companyName: input.companyName,
          businessAddress: input.businessAddress,
          secNumber: input.secNumber,
          tin: input.tin,
          contactFirstName: input.firstName,
          contactLastName: input.lastName,
          contactMobile: input.mobileNumber,
          contactJobTitle: input.jobTitle,
        });
        return { applicationId: result.applicationId, status: 'pending' };
      } catch (err) {
        if (err instanceof DuplicatePendingApplicationError) {
          throw new ConflictException({ error: 'duplicate_pending_application' });
        }
        if (isSlugCollision(err)) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException({ error: 'slug_collision_retry_exhausted' });
  }

  // POST /tenants/:id/approve | /reject (tenant:approve, platform_admin
  // only). Cross-tenant by nature (the reviewer's own RLS GUC is their own
  // tenant), so this calls the SECURITY DEFINER function directly rather
  // than withTenantTx -- see decideTenantApplication() for the rationale.
  async decideApplication(
    ctx: RequestContext,
    applicationId: string,
    decision: 'approved' | 'rejected',
  ): Promise<TenantApplicationDecisionResponse> {
    try {
      const result = await decideTenantApplication(applicationId, decision, ctx.userId);
      if (decision === 'approved') {
        if (!result.ownerUserId || !result.passwordHash) {
          throw new Error('approved application has no invited owner user');
        }
        // Relayed out-of-band by the platform admin, exactly like a user
        // invite -- there is no email provider in the pinned stack.
        const activationToken = this.auth.signActivationToken(result.tenantId, result.ownerUserId, result.passwordHash);
        return { applicationId, status: decision, activationToken };
      }
      return { applicationId, status: decision };
    } catch (err) {
      if (err instanceof ApplicationNotPendingError) {
        throw new NotFoundException({ error: 'application_not_pending' });
      }
      throw err;
    }
  }
}

function slugify(companyName: string): string {
  return (
    companyName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tenant'
  );
}

function isSlugCollision(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505' &&
    'constraint' in err &&
    (err as { constraint: string }).constraint === 'tenants_slug_key'
  );
}
