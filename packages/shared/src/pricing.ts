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

// Price book size classes (CR pricebook-kyc-weather): one equipment type
// spans very different machines (a 3 t mini excavator vs a 40 t one), so the
// fixed price is set per type x size class. The class is generic; the
// per-type band says what it means for that kind of machine.
export const SizeClassSchema = z.enum(['mini', 'small', 'medium', 'large', 'extra_large']);
export type SizeClass = z.infer<typeof SizeClassSchema>;
export const SIZE_CLASSES = SizeClassSchema.options;
const SIZE_CLASS_BANDS: Record<string, Record<SizeClass, string>> = {
  excavator: { mini: 'under 6 t', small: '6-15 t', medium: '15-30 t', large: '30-50 t', extra_large: 'over 50 t' },
  crane: { mini: 'under 10 t lift', small: '10-25 t lift', medium: '25-50 t lift', large: '50-100 t lift', extra_large: 'over 100 t lift' },
  truck: { mini: 'under 4 m3', small: '4-10 m3', medium: '10-16 m3', large: '16-20 m3', extra_large: 'over 20 m3' },
  generator: { mini: 'under 20 kVA', small: '20-100 kVA', medium: '100-300 kVA', large: '300-750 kVA', extra_large: 'over 750 kVA' },
  loader: { mini: 'under 1 m3 bucket', small: '1-2 m3 bucket', medium: '2-3.5 m3 bucket', large: '3.5-5 m3 bucket', extra_large: 'over 5 m3 bucket' },
  roller: { mini: 'under 3 t', small: '3-8 t', medium: '8-12 t', large: '12-20 t', extra_large: 'over 20 t' },
  bulldozer: { mini: 'under 10 t', small: '10-20 t', medium: '20-30 t', large: '30-50 t', extra_large: 'over 50 t' },
};
const SIZE_CLASS_NAMES: Record<SizeClass, string> = { mini: 'Mini', small: 'Small', medium: 'Medium', large: 'Large', extra_large: 'Extra large' };

// "Medium (15-30 t)" for an excavator; the bare name for a type with no bands.
export function sizeClassLabel(sizeClass: SizeClass, equipmentTypeName?: string): string {
  const key = Object.keys(SIZE_CLASS_BANDS).find((k) => equipmentTypeName?.toLowerCase().includes(k));
  const band = key ? SIZE_CLASS_BANDS[key]![sizeClass] : null;
  return band ? `${SIZE_CLASS_NAMES[sizeClass]} (${band})` : SIZE_CLASS_NAMES[sizeClass];
}

export const RateCardCreateRequestSchema = z
  .object({
    equipmentTypeId: z.string().uuid(),
    // One unit's own rate, overriding its type's card. Omit for type-wide.
    equipmentId: z.string().uuid().optional(),
    // The price book row: type x size class. Omit for a type-wide card.
    sizeClass: SizeClassSchema.optional(),
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
  // Fewest hours a booking may ask for; 0 = only the date span applies.
  minHours: z.number().finite().min(0).max(999_999).default(0),
});
export type BillingSettingsInput = z.infer<typeof BillingSettingsSchema>;
