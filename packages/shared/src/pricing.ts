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
