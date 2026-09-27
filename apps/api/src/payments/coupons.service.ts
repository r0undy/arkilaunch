import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { auditLogs, coupons, withTenantTx } from '@arkilaunch/db';
import type { CouponCreate, CouponListResponse, CouponResponse, RequestContext } from '@arkilaunch/shared';
import { countRows } from '../common/count-rows.js';

const toResponse = (row: typeof coupons.$inferSelect): CouponResponse => ({
  id: row.id,
  code: row.code,
  discountType: row.discountType as CouponResponse['discountType'],
  discountValue: Number(row.discountValue),
  expiresAt: row.expiresAt?.toISOString() ?? null,
  maxUses: row.maxUses,
  oncePerCustomer: row.oncePerCustomer,
  redeemedCount: row.redeemedCount,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

// A rental company's coupon codes (cr-arkilaunch-coupons.md), managed by the
// staff who set its prices (pricing:manage). Redemption lives in
// payments.service.ts checkout; this is only the catalog.
@Injectable()
export class CouponsService {
  async list(ctx: RequestContext, limit: number, offset: number): Promise<CouponListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx.select().from(coupons).orderBy(desc(coupons.createdAt), desc(coupons.id)).limit(limit).offset(offset);
      return { items: rows.map(toResponse), total: await countRows(tx, coupons) };
    });
  }

  async create(ctx: RequestContext, input: CouponCreate): Promise<CouponResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [taken] = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, input.code)).limit(1);
      if (taken) throw new ConflictException({ error: 'coupon_code_taken' });
      const [row] = await tx
        .insert(coupons)
        .values({
          tenantId: ctx.tenantId,
          code: input.code,
          discountType: input.discountType,
          discountValue: String(input.discountValue),
          expiresAt: input.expiresAt ?? null,
          maxUses: input.maxUses ?? null,
          oncePerCustomer: input.oncePerCustomer,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('coupons insert returned no row');
      await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'CREATE', entity: 'coupons', entityId: row.id });
      return toResponse(row);
    });
  }

  async setActive(ctx: RequestContext, id: string, active: boolean): Promise<CouponResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.update(coupons).set({ active }).where(eq(coupons.id, id)).returning();
      if (!row) throw new NotFoundException({ error: 'coupon_not_found' });
      await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'UPDATE', entity: 'coupons', entityId: id });
      return toResponse(row);
    });
  }
}
