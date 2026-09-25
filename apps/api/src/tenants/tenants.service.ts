import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { desc, eq } from 'drizzle-orm';
import {
  ApplicationNotPendingError,
  DuplicatePendingApplicationError,
  getTenantBranding,
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
import { sendEmail } from '../email/send-email.js';
import { publicPhotoUrl } from '../fleet/fleet.service.js';
import { StorageService } from '../storage/storage.service.js';
import { validateUpload } from '../storage/upload-validation.js';

const brandingBucket = () => process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';
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

  // GET /tenants/applications (tenant:approve, platform_admin only). Cross-
  // tenant by nature, same rationale as decideApplication -- see
  // tenants_list_pending_applications() in migrations/0011.
  async listApplications(query: TenantApplicationListQuery): Promise<TenantApplicationListResponse> {
    const [items, total] = await Promise.all([
      listPendingTenantApplications(query.limit, query.offset),
      countPendingTenantApplications(),
    ]);
    return { items, total };
  }

  // GET /tenants/companies (tenant:approve). Cross-tenant aggregate read,
  // same SECURITY DEFINER rationale as listApplications (migration 0049).
  async listCompanies(): Promise<PlatformCompanyListResponse> {
    return PlatformCompanyListResponseSchema.parse({ items: await listPlatformCompanies() });
  }

  // PATCH /tenants/:id/status (tenant:approve). Audited in the function.
  async setCompanyStatus(ctx: RequestContext, tenantId: string, status: CompanyStatus) {
    try {
      await setPlatformCompanyStatus(tenantId, status, ctx.userId);
      return { tenantId, status };
    } catch (err) {
      if (err instanceof CompanyNotFoundError) throw new NotFoundException({ error: 'company_not_found' });
      throw err;
    }
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
  // write. Auto-approved (migration 0051): the owner is created 'invited'
  // with an unusable random password hash and is emailed an activation link
  // at once; POST /auth/activate then takes the tenant live. The emailed
  // token is the proof of email ownership. Slug is derived from the company
  // name with a numeric suffix on collision, since tenants.slug is UNIQUE.
  async register(input: TenantRegisterRequest): Promise<TenantRegisterResponse> {
    const baseSlug = slugify(input.companyName);
    const placeholderHash = await hash(randomBytes(32).toString('hex'));

    // A reserved label (www, admin, api, ...) is never minted: it would be
    // unreachable as a host (lib/host.ts), so start at the suffixed form.
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
        if (isSlugCollision(err)) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException({ error: 'slug_collision_retry_exhausted' });
  }

  // The link opens on the platform host (WEB_ORIGIN): an onboarding
  // tenant's own subdomain is not served until it is active.
  // ponytail: a lost email leaves the owner stuck until the 409 guard is
  // cleared by hand; add a "resend activation" route if that happens.
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

  // Branding (migration 0051). `tenantId` is the verified JWT's tenant for
  // owner/admin, or the company a platform admin picked (controller decides).
  async getBranding(tenantId: string): Promise<TenantBranding> {
    const row = await getTenantBranding(tenantId);
    if (!row) throw new NotFoundException({ error: 'company_not_found' });
    const { logoKey, heroKey, ...rest } = row;
    return { ...rest, logoUrl: publicPhotoUrl(logoKey), heroUrl: publicPhotoUrl(heroKey) };
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

  // Logo or hero image. Key built from the target tenant id, never request
  // input; magic bytes sniffed, and images only (the shared validator also
  // admits PDF). Passing no file removes the image.
  async setBrandingImage(
    ctx: RequestContext,
    tenantId: string,
    kind: 'logo' | 'hero',
    file: { buffer: Buffer; size: number } | null,
  ) {
    let key: string | null = null;
    if (file) {
      const validated = validateUpload(file);
      if (!validated.contentType.startsWith('image/')) {
        throw new UnprocessableEntityException({ error: 'image_required' });
      }
      key = this.storage.buildObjectKey(tenantId, validated.extension);
      await this.storage.uploadObject(brandingBucket(), key, file.buffer, validated.contentType);
    }
    try {
      await setTenantBrandingImage(tenantId, ctx.userId, kind, key);
    } catch (err) {
      if (err instanceof CompanyNotFoundError) throw new NotFoundException({ error: 'company_not_found' });
      throw err;
    }
    return this.getBranding(tenantId);
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
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505' &&
    'constraint' in err &&
    (err as { constraint: string }).constraint === 'tenants_slug_key'
  );
}
