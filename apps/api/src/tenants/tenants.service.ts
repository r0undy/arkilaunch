import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { desc, eq } from 'drizzle-orm';
import {
  ApplicationNotPendingError,
  DuplicatePendingApplicationError,
  EmailTakenError,
  pgError,
  getTenantBranding,
  getTenantPaymongoAccount,
  setTenantPaymongoAccount,
  setTenantBrandingImage,
  updateTenantBranding,
  decideTenantApplication,
  countPendingTenantApplications,
  listPlatformCompanies,
  setPlatformCompanyStatus,
  CompanyNotFoundError,
  listPendingTenantApplications,
  registerTenant,
  tenantApplications,
  tenants,
  withTenantTx,
  sendEmail,
} from '@arkilaunch/db';
import type {
  CompanyStatus,
  PlatformCompanyListResponse,
  RequestContext,
  TenantApplication,
  TenantApplicationDecisionResponse,
  TenantApplicationListQuery,
  TenantApplicationListResponse,
  TenantRegisterRequest,
  TenantRegisterResponse,
  TenantBranding,
  TenantBrandingUpdateRequest,
} from '@arkilaunch/shared';
import { isTenantSlug, PlatformCompanyListResponseSchema } from '@arkilaunch/shared';
import { AuthService } from '../auth/auth.service.js';
import { StorageService, equipmentBucket } from '../storage/storage.service.js';
import { DISPLAY_IMAGE_TYPES, validateUpload } from '../storage/upload-validation.js';
import { toBranding } from '../common/branding.js';

const logger = new Logger('TenantsService');

@Injectable()
export class TenantsService {
  constructor(
    private readonly auth: AuthService,
    private readonly storage: StorageService,
  ) {}
  async me(ctx: RequestContext) {
    const [tenant] = await withTenantTx(ctx, (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)),
    );
    return tenant;
  }

  // Cross-tenant by nature, hence the SECURITY DEFINER function.
  async listApplications(query: TenantApplicationListQuery): Promise<TenantApplicationListResponse> {
    const [items, total] = await Promise.all([
      listPendingTenantApplications(query.limit, query.offset),
      countPendingTenantApplications(),
    ]);
    return { items, total };
  }

  // Cross-tenant aggregate read via SECURITY DEFINER.
  async listCompanies(): Promise<PlatformCompanyListResponse> {
    return PlatformCompanyListResponseSchema.parse({ items: await listPlatformCompanies() });
  }

  // Audited in the function.
  async setCompanyStatus(ctx: RequestContext, tenantId: string, status: CompanyStatus) {
    try {
      await setPlatformCompanyStatus(tenantId, status, ctx.userId);
      return { tenantId, status };
    } catch (err) {
      if (err instanceof CompanyNotFoundError) throw new NotFoundException({ error: 'company_not_found' });
      throw err;
    }
  }

  // Same-tenant, so a normal RLS-scoped read.
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

  // No JWT, so no tenant context: the write goes through SECURITY DEFINER. The emailed activation token proves
  // email ownership; POST /auth/activate takes the tenant live.
  async register(input: TenantRegisterRequest): Promise<TenantRegisterResponse> {
    const baseSlug = slugify(input.companyName);
    const placeholderHash = await hash(randomBytes(32).toString('hex'));

    // A reserved label (www, admin, api, ...) would be unreachable as a host, so start at the suffixed form.
    let attempt = isTenantSlug(baseSlug) ? 0 : 1;
    while (attempt < 6) {
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
        await this.sendActivationEmail(input.email, input.companyName, slug, result, placeholderHash);
        return { applicationId: result.applicationId, status: 'approved' };
      } catch (err) {
        if (err instanceof DuplicatePendingApplicationError) {
          throw new ConflictException({ error: 'duplicate_pending_application' });
        }
        if (err instanceof EmailTakenError) throw new ConflictException({ error: 'email_taken' });
        if (isSlugCollision(err)) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException({ error: 'slug_collision_retry_exhausted' });
  }

  // The link opens on the platform host: an onboarding tenant's subdomain isn't served until it's active.
  // ponytail: a lost email leaves the owner stuck until the 409 guard is cleared by hand; add a "resend activation" route if that happens.
  private async sendActivationEmail(
    email: string,
    companyName: string,
    slug: string,
    result: { tenantId: string; ownerUserId: string },
    placeholderHash: string,
  ): Promise<void> {
    const token = this.auth.signActivationToken(result.tenantId, result.ownerUserId, placeholderHash);
    const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
    const link = `${origin}/activate?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`;
    try {
      await sendEmail(
        email,
        `Activate ${companyName} on ArkiLaunch`,
        `Welcome to ArkiLaunch.

Set your password to put ${companyName} online:
${link}

If you did not register, ignore this email.`,
      );
    } catch (err) {
      logger.error(`activation email to ${email} failed: ${String(err)}`);
    }
  }

  // `tenantId` is the verified JWT's tenant, or the company a platform admin picked (the controller decides).
  async getBranding(tenantId: string): Promise<TenantBranding> {
    const row = await getTenantBranding(tenantId);
    if (!row) throw new NotFoundException({ error: 'company_not_found' });
    return toBranding(row);
  }

  async updateBranding(ctx: RequestContext, tenantId: string, input: TenantBrandingUpdateRequest) {
    try {
      await updateTenantBranding(tenantId, ctx.userId, input);
    } catch (err) {
      if (err instanceof CompanyNotFoundError) throw new NotFoundException({ error: 'company_not_found' });
      throw err;
    }
    return this.getBranding(tenantId);
  }

  async getPaymongoAccount(tenantId: string) {
    return { accountId: await getTenantPaymongoAccount(tenantId) };
  }

  async setPaymongoAccount(ctx: RequestContext, tenantId: string, accountId: string | null) {
    try {
      await setTenantPaymongoAccount(tenantId, ctx.userId, accountId);
    } catch (err) {
      if (err instanceof CompanyNotFoundError) throw new NotFoundException({ error: 'company_not_found' });
      throw err;
    }
    return { accountId };
  }

  // Key built from the target tenant id, never request input; display images only. No file removes the image.
  async setBrandingImage(
    ctx: RequestContext,
    tenantId: string,
    kind: 'logo' | 'hero' | 'icon' | 'login',
    file: { buffer: Buffer; size: number } | null,
  ) {
    let key: string | null = null;
    if (file) {
      const validated = validateUpload(file, { allow: DISPLAY_IMAGE_TYPES });
      key = this.storage.buildObjectKey(tenantId, validated.extension);
      await this.storage.uploadObject(equipmentBucket(), key, file.buffer, validated.contentType);
    }
    try {
      await setTenantBrandingImage(tenantId, ctx.userId, kind, key);
    } catch (err) {
      if (err instanceof CompanyNotFoundError) throw new NotFoundException({ error: 'company_not_found' });
      throw err;
    }
    return this.getBranding(tenantId);
  }

  // Cross-tenant (the reviewer's GUC is their own tenant), so the SECURITY DEFINER function, not withTenantTx.
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
        // Relayed out-of-band by the platform admin, like a user invite.
        const activationToken = this.auth.signActivationToken(result.tenantId, result.ownerUserId, result.passwordHash);
        return { applicationId, status: decision, activationToken, tenantSlug: result.tenantSlug };
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

// Capped at 50 so the `-N` collision suffix still fits one 63-char DNS label.
function slugify(companyName: string): string {
  return (
    companyName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
      .replace(/^-+|-+$/g, '') || 'tenant'
  );
}

function isSlugCollision(err: unknown): boolean {
  const e = pgError(err);
  return e.code === '23505' && e.constraint === 'tenants_slug_key';
}
