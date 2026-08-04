import { z } from 'zod';

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
// free-text column today ('hourly, daily' per its own comment); this enum
// is the boundary validation for it.
export const RateTypeSchema = z.enum(['hourly', 'daily']);
export type RateType = z.infer<typeof RateTypeSchema>;

export const RateCardCreateRequestSchema = z
  .object({
    equipmentTypeId: z.string().uuid(),
    rateType: RateTypeSchema,
    rateValue: z.number().finite().positive().max(99_999_999.99),
    // Every money path (PayMongo, the pricing engine, round2HalfUp) is
    // PHP-only in V1; accepting another currency string would silently
    // produce a quote the engine prices in pesos regardless.
    currency: z.literal('PHP').default('PHP'),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
  })
  .refine((data) => !data.effectiveTo || !data.effectiveFrom || data.effectiveTo > data.effectiveFrom, {
    message: 'effectiveTo must be after effectiveFrom',
    path: ['effectiveTo'],
  });
export type RateCardCreateRequest = z.infer<typeof RateCardCreateRequestSchema>;

// PATCH /rate-cards/:id: append-only supersede, never an in-place edit
// (QAD-T44). Body carries only the new value; the service closes the
// existing row's window and inserts a successor.
export const RateCardSupersedeRequestSchema = z.object({
  rateValue: z.number().finite().positive().max(99_999_999.99),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
});
export type RateCardSupersedeRequest = z.infer<typeof RateCardSupersedeRequestSchema>;

export const RateCardListQuerySchema = z.object({
  equipmentTypeId: z.string().uuid().optional(),
  rateType: RateTypeSchema.optional(),
  includeSuperseded: z.coerce.boolean().default(false),
});
export type RateCardListQuery = z.infer<typeof RateCardListQuerySchema>;

export const PricingParametersQuerySchema = z.object({ region: z.string().min(1).default('NCR') });
export type PricingParametersQuery = z.infer<typeof PricingParametersQuerySchema>;
