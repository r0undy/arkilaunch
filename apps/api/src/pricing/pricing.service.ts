import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { auditLogs, dieselPriceReadings, pricingParameters, withTenantTx } from '@arkilaunch/db';
import type { DieselPriceEntry, PricingParametersInput, RequestContext } from '@arkilaunch/shared';

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
}
