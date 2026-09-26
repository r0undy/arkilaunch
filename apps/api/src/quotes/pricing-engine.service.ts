import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq, gt, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db, dieselPriceReadings, getBillingSettings, pricingParameters, rateCards } from '@arkilaunch/db';
import { rentFor, type Discount, type QuoteItemInput, type QuoteRequest, type RentPart, type RentUnit } from '@arkilaunch/shared';

// 2.0: rent charged in the card's own unit (rentFor), flat per-quote
// mobilization, custom lines.
const FORMULA_VERSION = '2.0';
const RENT_UNITS: readonly string[] = ['hourly', 'daily', 'monthly'];
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
  source: 'tenant_override' | 'doe_scrape' | 'platform_manual' | 'admin_override' | 'gaswatch';
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
  kind: 'equipment' | 'custom';
  description: string | null;
  equipmentTypeId: string | null;
  rateCardId: string | null;
  quantity: number;
  estimatedHours: number;
  mobilizationKm: number;
  demobilizationKm: number;
  // Effective per-hour figure (rent / hours + operator, maintenance, fuel),
  // so hours x quantity x hourlyRate = operatingCost (the deposit reads it).
  hourlyRatePhp: number;
  rentPhp: number;
  rentParts: RentPart[];
  operatingCostPhp: number;
  mobilizationCostPhp: number;
  demobilizationCostPhp: number;
  bufferPhp: number;
  subtotalPhp: number;
  pricingInputs: Record<string, unknown>;
}

export interface PricedQuote {
  items: PricedItem[];
  mobilizationPhp: number;
  demobilizationPhp: number;
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

  // Prices one line. An equipment line loads its rate card and charges the
  // rent in the card's own unit (rentFor), plus operator, maintenance and
  // fuel per hour of the hire; a custom line is the admin's own price.
  async priceItem(
    tx: Tx,
    tenantId: string,
    diesel: DieselResolution,
    input: QuoteItemInput,
    dailyHours = 8,
  ): Promise<PricedItem> {
    if (input.kind === 'custom') {
      return {
        kind: 'custom', description: input.description, equipmentTypeId: null, rateCardId: null,
        quantity: input.quantity, estimatedHours: 0, mobilizationKm: 0, demobilizationKm: 0,
        hourlyRatePhp: 0, rentPhp: 0, rentParts: [], operatingCostPhp: 0, mobilizationCostPhp: 0,
        demobilizationCostPhp: 0, bufferPhp: 0, subtotalPhp: round2HalfUp(input.unitPricePhp * input.quantity),
        pricingInputs: { unit_price_php: input.unitPricePhp, formula_version: FORMULA_VERSION },
      };
    }

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
    // Each equipment type is priced off its own cards only.
    if (rateCard.equipmentTypeId !== input.equipmentTypeId) {
      throw new UnprocessableEntityException({ error: 'rate_card_type_mismatch', rateCardId: input.rateCardId });
    }
    if (!RENT_UNITS.includes(rateCard.rateType)) {
      throw new UnprocessableEntityException({ error: 'rate_type_unsupported', rateType: rateCard.rateType });
    }
    const rateType = rateCard.rateType as RentUnit;

    const rateCardValuePhp = Number(rateCard.rateValue);
    const dailyRatePhp = rateType === 'monthly' ? await this.dailyRateBeside(tx, tenantId, rateCard, now) : null;
    const hours = input.days !== undefined ? input.days * dailyHours : input.estimatedHours;
    const rent = rentFor(rateType, rateCardValuePhp, hours, dailyHours, dailyRatePhp);
    const fuelPerHourCost = diesel.fuelLPerHour * diesel.pricePhp;
    const addersPerHour = diesel.operatorHourlyPhp + diesel.maintenanceHourlyPhp + fuelPerHourCost;
    const hourlyRate = (hours > 0 ? rent.rentPhp / hours : 0) + addersPerHour;
    const operatingCost = (rent.rentPhp + addersPerHour * hours) * input.quantity;

    // Legacy per-km transport; new quotes send 0 and use the flat per-quote amount.
    const transportRatePerKm = diesel.transportPhpPerKm + diesel.fuelLPerKm * diesel.pricePhp;
    const mobilizationCost = input.mobilizationKm * transportRatePerKm * input.quantity;
    const demobilizationCost = input.demobilizationKm * transportRatePerKm * input.quantity;

    const itemBase = operatingCost + mobilizationCost + demobilizationCost;
    const buffer = itemBase * diesel.bufferPct;
    const computedSubtotal = round2HalfUp(itemBase + buffer);
    // Negotiation: staff may set an agreed price for this line. It replaces
    // the line subtotal on this quote only; the computed figure is kept
    // beside it in pricing_inputs so the snapshot shows both.
    const agreed = input.agreedSubtotalPhp;
    const subtotal = agreed !== undefined ? round2HalfUp(agreed) : computedSubtotal;
    const rentPhp = round2HalfUp(rent.rentPhp * input.quantity);

    return {
      kind: 'equipment',
      description: null,
      equipmentTypeId: input.equipmentTypeId,
      rateCardId: input.rateCardId,
      quantity: input.quantity,
      estimatedHours: hours,
      mobilizationKm: input.mobilizationKm,
      demobilizationKm: input.demobilizationKm,
      hourlyRatePhp: round2HalfUp(hourlyRate),
      rentPhp,
      rentParts: rent.parts,
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
        rate_card_rate_type: rateType,
        rate_card_equipment_id: rateCard.equipmentId,
        daily_hours: dailyHours,
        daily_rate_php: dailyRatePhp,
        rent_php: rentPhp,
        rent_parts: rent.parts,
        ...(agreed !== undefined ? { agreed_subtotal_php: subtotal, computed_subtotal_php: computedSubtotal } : {}),
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

  // The daily card beside a monthly one (same unit, else same type), which
  // charges a monthly hire's leftover days. null: pro-rate the month.
  private async dailyRateBeside(
    tx: Tx,
    tenantId: string,
    card: { equipmentTypeId: string; equipmentId: string | null },
    now: Date,
  ): Promise<number | null> {
    const typeWide = and(eq(rateCards.equipmentTypeId, card.equipmentTypeId), isNull(rateCards.equipmentId));
    const [daily] = await tx
      .select({ rateValue: rateCards.rateValue })
      .from(rateCards)
      .where(
        and(
          eq(rateCards.tenantId, tenantId),
          eq(rateCards.rateType, 'daily'),
          card.equipmentId ? or(eq(rateCards.equipmentId, card.equipmentId), typeWide) : typeWide,
          lte(rateCards.effectiveFrom, now),
          or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, now)),
        ),
      )
      .orderBy(sql`${rateCards.equipmentId} is null`, desc(rateCards.effectiveFrom))
      .limit(1);
    return daily ? Number(daily.rateValue) : null;
  }

  // Subtotal = the lines plus the flat mobilization/demobilization; the
  // discount comes off that.
  applyDiscount(
    items: ReadonlyArray<Pick<PricedItem, 'subtotalPhp'>>,
    discount: Discount,
    transportPhp = 0,
  ): { subtotalPhp: number; discountPhp: number; totalPhp: number } {
    const subtotal = round2HalfUp(items.reduce((sum, item) => sum + item.subtotalPhp, 0) + transportPhp);
    let discountAmount = 0;
    if (discount.type === 'percent') discountAmount = subtotal * (discount.value / 100);
    else if (discount.type === 'fixed') discountAmount = discount.value;
    const total = round2HalfUp(Math.max(0, subtotal - discountAmount));
    return { subtotalPhp: subtotal, discountPhp: round2HalfUp(discountAmount), totalPhp: total };
  }

  async priceQuote(
    tx: Tx,
    tenantId: string,
    request: Pick<QuoteRequest, 'items' | 'discount'>,
    region = 'NCR',
  ): Promise<PricedQuote> {
    const diesel = await this.resolveDieselAndParams(tx, tenantId, region);
    const settings = await getBillingSettings(tx, tenantId);
    const pricedItems: PricedItem[] = [];
    for (const item of request.items) {
      pricedItems.push(await this.priceItem(tx, tenantId, diesel, item, settings.dailyHours));
    }
    // The admin's fixed fees; never set per quote.
    const mobilizationPhp = round2HalfUp(settings.mobilizationPhp);
    const demobilizationPhp = round2HalfUp(settings.demobilizationPhp);
    const totals = this.applyDiscount(pricedItems, request.discount, mobilizationPhp + demobilizationPhp);
    return { items: pricedItems, diesel, mobilizationPhp, demobilizationPhp, ...totals };
  }
}
