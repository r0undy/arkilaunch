import { BadGatewayException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
  auditLogs,
  billingSettings,
  db,
  dieselPriceReadings,
  equipment,
  getBillingSettings,
  pricingParameters,
  rateCards,
  recordGasWatchDieselReading,
  recordManualDieselReading,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  BillingSettingsInput,
  DieselPriceEntry,
  PricingParametersInput,
  RateCardCreateRequest,
  RateCardListQuery,
  RateCardSupersedeRequest,
  RequestContext,
} from '@arkilaunch/shared';
import { countRows } from '../common/count-rows.js';

@Injectable()
export class PricingService {
  // Platform manual entry (RFC-3 §2/§3 QUOTE-05): used when the scrape
  // breaks or is off. Audit-logged so a hand-entered price is attributable.
  async recordDieselPrice(ctx: RequestContext, input: DieselPriceEntry) {
    // The insert goes through the SECURITY DEFINER function, because
    // app_authenticated no longer holds INSERT on this global, un-RLS'd
    // table (audit-db-tenant-isolation.md #7, migration 0020). It
    // therefore runs outside the tenant transaction below, which only
    // writes the audit row.
    const reading = await recordManualDieselReading({
      region: input.region,
      pricePhp: String(input.pricePhp),
      observedDate: input.observedDate,
      sourceUrl: input.sourceUrl ?? null,
      capturedBy: ctx.userId,
    });

    await withTenantTx(ctx, async (tx) => {
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'diesel_price_readings',
        entityId: reading.id,
      });
    });

    return {
      id: reading.id,
      region: reading.region,
      pricePhp: reading.price_php,
      observedDate: reading.observed_date,
      source: reading.source,
      sourceUrl: reading.source_url,
      capturedAt: reading.captured_at,
      capturedBy: reading.captured_by,
    };
  }

  // GET /pricing/diesel-price: the latest national reading (what a quote
  // prices against when the tenant has no fresh override).
  async latestDieselPrice(region: string) {
    const [latest] = await db
      .select()
      .from(dieselPriceReadings)
      .where(eq(dieselPriceReadings.region, region))
      .orderBy(desc(dieselPriceReadings.observedDate), desc(dieselPriceReadings.capturedAt))
      .limit(1);
    return latest
      ? { pricePhp: Number(latest.pricePhp), observedDate: latest.observedDate, source: latest.source, capturedAt: latest.capturedAt }
      : null;
  }

  // POST /pricing/diesel-price/fetch: the admin "Fetch now" button. Same
  // fetch as the weekly job; the URL is fixed server-side, so nothing the
  // caller sends reaches the global reading.
  async fetchGasWatchDiesel(ctx: RequestContext, region: string) {
    let reading;
    try {
      reading = await recordGasWatchDieselReading(region);
    } catch (err) {
      throw new BadGatewayException({ error: 'gaswatch_unavailable', message: err instanceof Error ? err.message : String(err) });
    }
    await withTenantTx(ctx, async (tx) => {
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'diesel_price_readings',
        entityId: reading.id,
      });
    });
    return this.latestDieselPrice(region);
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
          dieselOverridePhp:
            input.dieselOverridePhp !== undefined ? String(input.dieselOverridePhp) : null,
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
      if (query.equipmentTypeId)
        conditions.push(eq(rateCards.equipmentTypeId, query.equipmentTypeId));
      if (query.rateType) conditions.push(eq(rateCards.rateType, query.rateType));
      if (!query.includeSuperseded) {
        conditions.push(lte(rateCards.effectiveFrom, now));
        conditions.push(or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, now)));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await tx
        .select()
        .from(rateCards)
        .where(where)
        .orderBy(desc(rateCards.effectiveFrom))
        .limit(query.limit)
        .offset(query.offset);
      const total = await countRows(tx, rateCards, where);
      return { items: rows, total };
    });
  }

  // POST /rate-cards (S18). App-layer overlap guard: no DB exclusion
  // constraint (would need btree_gist, restraint ladder) -- same posture as
  // pricing_parameters' own append-only supersede.
  async createRateCard(ctx: RequestContext, input: RateCardCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
      const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;

      // A unit card must name this tenant's unit of this type. The FK alone
      // would accept another tenant's id (FK checks bypass RLS).
      if (input.equipmentId) {
        const [unit] = await tx.select().from(equipment).where(eq(equipment.id, input.equipmentId)).limit(1);
        if (!unit || unit.equipmentTypeId !== input.equipmentTypeId) {
          throw new NotFoundException({ error: 'equipment_not_found' });
        }
      }

      const overlapping = await tx
        .select()
        .from(rateCards)
        .where(
          and(
            eq(rateCards.equipmentTypeId, input.equipmentTypeId),
            input.equipmentId ? eq(rateCards.equipmentId, input.equipmentId) : isNull(rateCards.equipmentId),
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
          equipmentId: input.equipmentId ?? null,
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
          equipmentId: existing.equipmentId,
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

  // GET/PUT /pricing/billing-settings.
  async getBillingSettings(ctx: RequestContext) {
    return withTenantTx(ctx, (tx) => getBillingSettings(tx, ctx.tenantId));
  }

  async setBillingSettings(ctx: RequestContext, input: BillingSettingsInput) {
    return withTenantTx(ctx, async (tx) => {
      const values = {
        dailyHours: String(input.dailyHours),
        minDepositPhp: String(input.minDepositPhp),
        lowBalancePct: String(input.lowBalancePct),
        depositPct: String(input.depositPct),
        mobilizationPhp: String(input.mobilizationPhp),
        demobilizationPhp: String(input.demobilizationPhp),
        updatedAt: new Date(),
      };
      await tx
        .insert(billingSettings)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: billingSettings.tenantId, set: values });
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'billing_settings',
        entityId: ctx.tenantId,
      });
      return input;
    });
  }
}
