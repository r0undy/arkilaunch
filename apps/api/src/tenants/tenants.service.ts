import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditLogs, tenants, withTenantTx } from '@arkilaunch/db';
import type { RequestContext, TenantSettingsUpdateRequest } from '@arkilaunch/shared';

@Injectable()
export class TenantsService {
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
}
