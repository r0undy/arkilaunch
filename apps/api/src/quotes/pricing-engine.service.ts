import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db, dieselPriceReadings, pricingParameters, rateCards } from '@arkilaunch/db';
import type { Discount, QuoteItemInput } from '@arkilaunch/shared';

const FORMULA_VERSION = '1.0';
// RFC-3 §3: default staleness window; DOE updates weekly (typically
// Tuesdays), so a week-old reading is still usable, just labeled stale.
const STALENESS_WINDOW_DAYS = 7;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// RFC-3 §3: monetary outputs round half-up to 2 decimals; intermediate
// values stay full-precision. Number.EPSILON guards the classic
// floating-point half-up edge case (e.g. 1.005 truncating to 1.00).
export function round2HalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface DieselResolution {
  pricePhp: number;
  observedDate: string;
  source: 'tenant_override' | 'doe_scrape' | 'platform_manual' | 'admin_override';
  stale: boolean;
  readingId: string | null;
  pricingParamsId: string;
  operatorHourlyPhp: number;
  maintenanceHourlyPhp: number;
  bufferPct: number;
  fuelLPerHour: number;
  fuelLPerKm: number;
  transportPhpPerKm: number;
}

export interface PricedItem {
  equipmentTypeId: string;
  rateCardId: string;
  quantity: number;
  estimatedHours: number;
  mobilizationKm: number;
  demobilizationKm: number;
  hourlyRatePhp: number;
  operatingCostPhp: number;
  mobilizationCostPhp: number;
  demobilizationCostPhp: number;
  bufferPhp: number;
  subtotalPhp: number;
  pricingInputs: Record<string, unknown>;
}

export interface PricedQuote {
  items: PricedItem[];
  subtotalPhp: number;
  discountPhp: number;
  totalPhp: number;
  diesel: DieselResolution;
}

@Injectable()
export class PricingEngineService {
  // RFC-3 §3 diesel-price resolution order: tenant override (fresh) -> latest
  // reading (fresh) -> latest reading (stale, price_stale=true) -> 422.
  async resolveDieselAndParams(tx: Tx, tenantId: string, region = 'NCR'): Promise<DieselResolution> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALENESS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [params] = await tx
      .select()
      .from(pricingParameters)
      .where(
        and(
          eq(pricingParameters.tenantId, tenantId),
          eq(pricingParameters.region, region),
          lte(pricingParameters.effectiveFrom, now),
          or(isNull(pricingParameters.effectiveTo), gte(pricingParameters.effectiveTo, now)),
        ),
      )
      .orderBy(desc(pricingParameters.effectiveFrom))
      .limit(1);

    if (!params) {
      throw new UnprocessableEntityException({
        error: 'no_diesel_price',
        message: `No pricing parameters configured for region ${region}; configure pricing_parameters to continue.`,
      });
    }

    const paramFields = {
      pricingParamsId: params.id,
      operatorHourlyPhp: Number(params.operatorHourlyPhp),
      maintenanceHourlyPhp: Number(params.maintenanceHourlyPhp),
      bufferPct: Number(params.bufferPct),
      fuelLPerHour: Number(params.fuelLPerHour),
      fuelLPerKm: Number(params.fuelLPerKm),
      transportPhpPerKm: Number(params.transportPhpPerKm),
    };

    // 1. Tenant override, if set and fresh.
    if (params.dieselOverridePhp && params.dieselOverrideDate) {
      const overrideDate = new Date(params.dieselOverrideDate);
      if (overrideDate >= staleBefore) {
        return {
          pricePhp: Number(params.dieselOverridePhp),
          observedDate: params.dieselOverrideDate,
          source: 'tenant_override',
          stale: false,
          readingId: null,
          ...paramFields,
        };
      }
    }

    // 2/3. Latest reading for the region, fresh or stale.
    const [latest] = await tx
      .select()
      .from(dieselPriceReadings)
      .where(eq(dieselPriceReadings.region, region))
      .orderBy(desc(dieselPriceReadings.observedDate))
      .limit(1);

    if (latest) {
      const observed = new Date(latest.observedDate);
      return {
        pricePhp: Number(latest.pricePhp),
        observedDate: latest.observedDate,
        source: latest.source as DieselResolution['source'],
        stale: observed < staleBefore,
        readingId: latest.id,
        ...paramFields,
      };
    }

    // 4. Nothing at all: never price against an unknown value (US-03).
    throw new UnprocessableEntityException({
      error: 'no_diesel_price',
      message: `No diesel price available for region ${region}; enter one to continue.`,
    });
  }

  // Loads the rate card and prices one line item per the RFC-3 §3 formula.
  async priceItem(tx: Tx, tenantId: string, diesel: DieselResolution, input: QuoteItemInput): Promise<PricedItem> {
    const now = new Date();
    const [rateCard] = await tx
      .select()
      .from(rateCards)
      .where(and(eq(rateCards.id, input.rateCardId), eq(rateCards.tenantId, tenantId)))
      .limit(1);

    if (!rateCard) {
      throw new UnprocessableEntityException({ error: 'rate_card_not_found', rateCardId: input.rateCardId });
    }

    // A rate card is append-only (only effective_to ever moves; see
    // migration 0007 + PricingService.setPricingParameters, the existing
    // precedent). Once superseded, its id must never be able to price a NEW
    // quote at the old value -- QAD-T44/T48. `revise()` is the only path a
    // rate change should reach a customer through.
    const effectiveFrom = new Date(rateCard.effectiveFrom);
    const effectiveTo = rateCard.effectiveTo ? new Date(rateCard.effectiveTo) : null;
    if (effectiveFrom > now || (effectiveTo && effectiveTo <= now)) {
      throw new UnprocessableEntityException({
        error: 'rate_card_not_effective',
        rateCardId: input.rateCardId,
        message: 'This rate card is not currently effective (superseded or not yet active); reload rate cards.',
      });
    }

    const rateCardValuePhp = Number(rateCard.rateValue);
    const fuelPerHourCost = diesel.fuelLPerHour * diesel.pricePhp;
    const hourlyRate = rateCardValuePhp + diesel.operatorHourlyPhp + diesel.maintenanceHourlyPhp + fuelPerHourCost;
    const operatingCost = hourlyRate * input.estimatedHours * input.quantity;

    const transportRatePerKm = diesel.transportPhpPerKm + diesel.fuelLPerKm * diesel.pricePhp;
    const mobilizationCost = input.mobilizationKm * transportRatePerKm * input.quantity;
    const demobilizationCost = input.demobilizationKm * transportRatePerKm * input.quantity;

    const itemBase = operatingCost + mobilizationCost + demobilizationCost;
    const buffer = itemBase * diesel.bufferPct;
    const subtotal = round2HalfUp(itemBase + buffer);

    return {
      equipmentTypeId: input.equipmentTypeId,
      rateCardId: input.rateCardId,
      quantity: input.quantity,
      estimatedHours: input.estimatedHours,
      mobilizationKm: input.mobilizationKm,
      demobilizationKm: input.demobilizationKm,
      hourlyRatePhp: round2HalfUp(hourlyRate),
      operatingCostPhp: round2HalfUp(operatingCost),
      mobilizationCostPhp: round2HalfUp(mobilizationCost),
      demobilizationCostPhp: round2HalfUp(demobilizationCost),
      bufferPhp: round2HalfUp(buffer),
      subtotalPhp: subtotal,
      pricingInputs: {
        diesel_price_php: diesel.pricePhp,
        diesel_price_date: diesel.observedDate,
        diesel_price_source: diesel.source,
        rate_card_id: rateCard.id,
        rate_card_value_php: rateCardValuePhp,
        rate_card_effective_from: rateCard.effectiveFrom,
        rate_card_effective_to: rateCard.effectiveTo,
        operator_hourly_php: diesel.operatorHourlyPhp,
        maintenance_hourly_php: diesel.maintenanceHourlyPhp,
        buffer_pct: diesel.bufferPct,
        fuel_l_per_hour: diesel.fuelLPerHour,
        fuel_l_per_km: diesel.fuelLPerKm,
        transport_php_per_km: diesel.transportPhpPerKm,
        formula_version: FORMULA_VERSION,
      },
    };
  }

  applyDiscount(items: PricedItem[], discount: Discount): { subtotalPhp: number; discountPhp: number; totalPhp: number } {
    const subtotal = round2HalfUp(items.reduce((sum, item) => sum + item.subtotalPhp, 0));
    let discountAmount = 0;
    if (discount.type === 'percent') discountAmount = subtotal * (discount.value / 100);
    else if (discount.type === 'fixed') discountAmount = discount.value;
    const total = round2HalfUp(Math.max(0, subtotal - discountAmount));
    return { subtotalPhp: subtotal, discountPhp: round2HalfUp(discountAmount), totalPhp: total };
  }

  async priceQuote(
    tx: Tx,
    tenantId: string,
    items: QuoteItemInput[],
    discount: Discount,
    region = 'NCR',
  ): Promise<PricedQuote> {
    const diesel = await this.resolveDieselAndParams(tx, tenantId, region);
    const pricedItems: PricedItem[] = [];
    for (const item of items) {
      pricedItems.push(await this.priceItem(tx, tenantId, diesel, item));
    }
    const totals = this.applyDiscount(pricedItems, discount);
    return { items: pricedItems, diesel, ...totals };
  }
}
