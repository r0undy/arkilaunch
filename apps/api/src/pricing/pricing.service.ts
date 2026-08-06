import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { auditLogs, dieselPriceReadings, pricingParameters, rateCards, withTenantTx } from '@arkilaunch/db';
import type {
  DieselPriceEntry,
  PricingParametersInput,
  RateCardCreateRequest,
  RateCardListQuery,
  RateCardSupersedeRequest,
  RequestContext,
} from '@arkilaunch/shared';

@Injectable()
export class PricingService {
  // Platform manual entry (RFC-3 §2/§3 QUOTE-05): used when the scrape
  // breaks or is off. Audit-logged so a hand-entered price is attributable.
  async recordDieselPrice(ctx: RequestContext, input: DieselPriceEntry) {
    return withTenantTx(ctx, async (tx) => {
      const [reading] = await tx
        .insert(dieselPriceReadings)
        .values({
          region: input.region,
          pricePhp: String(input.pricePhp),
          observedDate: input.observedDate,
          source: 'platform_manual',
          sourceUrl: input.sourceUrl,
          capturedBy: ctx.userId,
        })
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'diesel_price_readings',
        entityId: reading!.id,
      });

      return reading;
    });
  }

  // Tenant diesel override + pricing inputs (RFC-3 §2/§3 QUOTE-05):
  // time-variant, never overwritten. Closes any prior open-ended row for
  // the same tenant/region so the "latest effective_from" lookup in
  // PricingEngineService stays correct, then inserts the new one.
  async setPricingParameters(ctx: RequestContext, input: PricingParametersInput) {
    return withTenantTx(ctx, async (tx) => {
      const effectiveFrom = new Date();

      await tx
        .update(pricingParameters)
        .set({ effectiveTo: effectiveFrom })
        .where(
          and(
            eq(pricingParameters.tenantId, ctx.tenantId),
            eq(pricingParameters.region, input.region),
            isNull(pricingParameters.effectiveTo),
          ),
        );

      const [params] = await tx
        .insert(pricingParameters)
        .values({
          tenantId: ctx.tenantId,
          region: input.region,
          operatorHourlyPhp: String(input.operatorHourlyPhp),
          maintenanceHourlyPhp: String(input.maintenanceHourlyPhp),
          bufferPct: String(input.bufferPct),
          fuelLPerHour: String(input.fuelLPerHour),
          fuelLPerKm: String(input.fuelLPerKm),
          transportPhpPerKm: String(input.transportPhpPerKm),
          dieselOverridePhp: input.dieselOverridePhp !== undefined ? String(input.dieselOverridePhp) : null,
          dieselOverrideDate: input.dieselOverrideDate ?? null,
          effectiveFrom,
        })
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: input.dieselOverridePhp !== undefined ? 'UPDATE' : 'CREATE',
        entity: 'pricing_parameters',
        entityId: params!.id,
      });

      return params;
    });
  }

  // GET /pricing/parameters?region= (S18). Read-only complement to
  // setPricingParameters -- the currently-effective row for the region, or
  // null if none has ever been set.
  async getPricingParameters(ctx: RequestContext, region: string) {
    return withTenantTx(ctx, async (tx) => {
      const now = new Date();
      const [params] = await tx
        .select()
        .from(pricingParameters)
        .where(
          and(
            eq(pricingParameters.tenantId, ctx.tenantId),
            eq(pricingParameters.region, region),
            lte(pricingParameters.effectiveFrom, now),
            or(isNull(pricingParameters.effectiveTo), gt(pricingParameters.effectiveTo, now)),
          ),
        )
        .orderBy(desc(pricingParameters.effectiveFrom))
        .limit(1);
      return params ?? null;
    });
  }

  // GET /rate-cards (S18). Full history by default (the settings screen's
  // effective-dating timeline); ?includeSuperseded=false narrows to
  // currently-effective rows, matching ReferenceService.rateCards()'s
  // pick-list filter.
  async listRateCards(ctx: RequestContext, query: RateCardListQuery) {
    return withTenantTx(ctx, async (tx) => {
      const now = new Date();
      const conditions = [];
      if (query.equipmentTypeId) conditions.push(eq(rateCards.equipmentTypeId, query.equipmentTypeId));
      if (query.rateType) conditions.push(eq(rateCards.rateType, query.rateType));
      if (!query.includeSuperseded) {
        conditions.push(lte(rateCards.effectiveFrom, now));
        conditions.push(or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, now)));
      }

      const rows = await tx
        .select()
        .from(rateCards)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(rateCards.effectiveFrom));
      return { items: rows, total: rows.length };
    });
  }

  // POST /rate-cards (S18). App-layer overlap guard: no DB exclusion
  // constraint (would need btree_gist, restraint ladder) -- same posture as
  // pricing_parameters' own append-only supersede.
  async createRateCard(ctx: RequestContext, input: RateCardCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
      const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;

      const overlapping = await tx
        .select()
        .from(rateCards)
        .where(
          and(
            eq(rateCards.equipmentTypeId, input.equipmentTypeId),
            eq(rateCards.rateType, input.rateType),
            lte(rateCards.effectiveFrom, effectiveTo ?? new Date('9999-12-31')),
            or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, effectiveFrom)),
          ),
        )
        .limit(1);
      if (overlapping.length > 0) {
        throw new ConflictException({ error: 'rate_card_window_overlap' });
      }

      const [card] = await tx
        .insert(rateCards)
        .values({
          tenantId: ctx.tenantId,
          equipmentTypeId: input.equipmentTypeId,
          rateType: input.rateType,
          rateValue: String(input.rateValue),
          currency: input.currency,
          effectiveFrom,
          effectiveTo,
        })
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'rate_cards',
        entityId: card!.id,
      });

      return card;
    });
  }

  // PATCH /rate-cards/:id (S18, QAD-T44). Append-only supersede: closes the
  // existing row's window and inserts a successor. Never an in-place
  // UPDATE ... SET rate_value -- migration 0007 also revokes that
  // privilege at the DB layer, so this is a guarantee, not a convention.
  async supersedeRateCard(ctx: RequestContext, id: string, input: RateCardSupersedeRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx.select().from(rateCards).where(eq(rateCards.id, id)).limit(1);
      if (!existing) throw new NotFoundException({ error: 'rate_card_not_found' });

      const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();

      await tx.update(rateCards).set({ effectiveTo: effectiveFrom }).where(eq(rateCards.id, id));

      const [successor] = await tx
        .insert(rateCards)
        .values({
          tenantId: ctx.tenantId,
          equipmentTypeId: existing.equipmentTypeId,
          rateType: existing.rateType,
          rateValue: String(input.rateValue),
          currency: existing.currency,
          effectiveFrom,
        })
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'rate_cards',
        entityId: successor!.id,
      });

      return { id: successor!.id, supersededId: existing.id, effectiveFrom };
    });
  }

  // DELETE /rate-cards/:id (S18): retire = close the window, never a row
  // delete. migration 0007 revokes DELETE on rate_cards entirely for
  // app_authenticated, so this can only ever narrow the effective window.
  async retireRateCard(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx.select().from(rateCards).where(eq(rateCards.id, id)).limit(1);
      if (!existing) throw new NotFoundException({ error: 'rate_card_not_found' });

      await tx.update(rateCards).set({ effectiveTo: new Date() }).where(eq(rateCards.id, id));

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'rate_cards',
        entityId: id,
      });

      return { id, retired: true };
    });
  }
}
