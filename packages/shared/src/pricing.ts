import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

// RFC-3 §3/§7 QUOTE-05: platform manual diesel-price entry and the tenant
// diesel override, both audit-logged, both usable with ENABLE_DIESEL_SCRAPE
// off.
export const DieselPriceEntrySchema = z.object({
  region: z.string().min(1).default('NCR'),
  pricePhp: z.number().finite().min(20).max(150), // price_sane CHECK, RFC-3 §3
  observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceUrl: z.string().url().optional(),
});
export type DieselPriceEntry = z.infer<typeof DieselPriceEntrySchema>;

export const PricingParametersInputSchema = z.object({
  region: z.string().min(1).default('NCR'),
  operatorHourlyPhp: z.number().finite().min(0),
  maintenanceHourlyPhp: z.number().finite().min(0),
  bufferPct: z.number().finite().min(0).max(1).default(0.1),
  fuelLPerHour: z.number().finite().min(0),
  fuelLPerKm: z.number().finite().min(0),
  transportPhpPerKm: z.number().finite().min(0).default(0),
  dieselOverridePhp: z.number().finite().min(20).max(150).optional(),
  dieselOverrideDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type PricingParametersInput = z.infer<typeof PricingParametersInputSchema>;

// S18 Rate Cards & Tenant Settings (PRD-F1/F7). rate_cards.rate_type is a
// free-text column; this enum is the boundary validation for it. A card is
// charged in its own unit (see rentFor in quotes.ts).
export const RateTypeSchema = z.enum(['hourly', 'daily', 'monthly']);
export type RateType = z.infer<typeof RateTypeSchema>;

export const RateCardCreateRequestSchema = z
  .object({
    equipmentTypeId: z.string().uuid(),
    // One unit's own rate, overriding its type's card. Omit for type-wide.
    equipmentId: z.string().uuid().optional(),
    rateType: RateTypeSchema,
    rateValue: z.number().finite().positive().max(99_999_999.99),
    // Every money path (PayMongo, the pricing engine, round2HalfUp) is
    // PHP-only in V1; accepting another currency string would silently
    // produce a quote the engine prices in pesos regardless.
    currency: z.literal('PHP').default('PHP'),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (data) => !data.effectiveTo || !data.effectiveFrom || data.effectiveTo > data.effectiveFrom,
    {
      message: 'effectiveTo must be after effectiveFrom',
      path: ['effectiveTo'],
    },
  );
export type RateCardCreateRequest = z.infer<typeof RateCardCreateRequestSchema>;

// PATCH /rate-cards/:id: append-only supersede, never an in-place edit
// (QAD-T44). Body carries only the new value; the service closes the
// existing row's window and inserts a successor.
export const RateCardSupersedeRequestSchema = z.object({
  rateValue: z.number().finite().positive().max(99_999_999.99),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
});
export type RateCardSupersedeRequest = z.infer<typeof RateCardSupersedeRequestSchema>;

export const RateCardListQuerySchema = PaginationQuerySchema.extend({
  equipmentTypeId: z.string().uuid().optional(),
  rateType: RateTypeSchema.optional(),
  // stringbool, not coerce.boolean: coerce turns the query text "false" into true.
  includeSuperseded: z.stringbool().default(false),
});
export type RateCardListQuery = z.infer<typeof RateCardListQuerySchema>;

// GET /reference/rate-cards: the pick-list variant, which takes only the
// type filter. It was the one @Query in the API with no createZodDto at
// all, so the global Zod pipe had nothing to validate and a non-uuid went
// straight into the query (audit-api-surface.md #7).
export const ReferenceRateCardQuerySchema = z.object({
  equipmentTypeId: z.string().uuid().optional(),
});
export type ReferenceRateCardQuery = z.infer<typeof ReferenceRateCardQuerySchema>;

export const PricingParametersQuerySchema = z.object({ region: z.string().min(1).default('NCR') });
export type PricingParametersQuery = z.infer<typeof PricingParametersQuerySchema>;

// GET/PUT /pricing/billing-settings: hours in a rental day (daily card ->
// hourly), the minimum deposit, and the low-balance warning threshold.
export const BillingSettingsSchema = z.object({
  dailyHours: z.number().finite().positive().max(24),
  minDepositPhp: z.number().finite().min(0).max(99_999_999.99),
  lowBalancePct: z.number().finite().min(0).max(100),
  // Deposit as a percent of the quote total; 0 = flat minDepositPhp only.
  depositPct: z.number().finite().min(0).max(100).default(0),
  // Flat transport every new quote starts with; the admin can change it per quote.
  mobilizationPhp: z.number().finite().min(0).max(99_999_999.99).default(0),
  demobilizationPhp: z.number().finite().min(0).max(99_999_999.99).default(0),
});
export type BillingSettingsInput = z.infer<typeof BillingSettingsSchema>;
