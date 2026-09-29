import { z } from 'zod';

export const DiscountSchema = z
  .object({
    type: z.enum(['none', 'percent', 'fixed']).default('none'),
    value: z.number().finite().min(0).default(0),
  })
  .default({ type: 'none', value: 0 });
export type Discount = z.infer<typeof DiscountSchema>;

const PhpAmount = z.number().finite().min(0).max(99_999_999.99);

export const EquipmentQuoteItemSchema = z.object({
  kind: z.literal('equipment').optional(),
  equipmentTypeId: z.string().uuid(),
  quantity: z.number().int().min(1),
  rateCardId: z.string().uuid(),
  estimatedHours: z.number().finite().min(0),
  days: z.number().finite().min(0).max(3650).optional(),
  mobilizationKm: z.number().finite().min(0).default(0),
  demobilizationKm: z.number().finite().min(0).default(0),
  // Replaces the computed subtotal on this quote only (audit-logged).
  agreedSubtotalPhp: PhpAmount.optional(),
});

export const CustomQuoteItemSchema = z.object({
  kind: z.literal('custom'),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1),
  unitPricePhp: PhpAmount,
});

// custom first: an equipment line may omit kind.
export const QuoteItemInputSchema = z.union([CustomQuoteItemSchema, EquipmentQuoteItemSchema]);
export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;
export type EquipmentQuoteItem = z.infer<typeof EquipmentQuoteItemSchema>;

export const QuoteRequestSchema = z.object({
  customerId: z.string().uuid(),
  projectSiteId: z.string().uuid(),
  rentalId: z.string().uuid(),
  discount: DiscountSchema,
  items: z.array(QuoteItemInputSchema).min(1),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export type RentUnit = 'hourly' | 'daily' | 'monthly';

export interface RentPart {
  rateType: RentUnit;
  ratePhp: number;
  count: number;
}

export function rentFor(ratePhp: number, hours: number): { rentPhp: number; parts: RentPart[] } {
  return { rentPhp: ratePhp * hours, parts: [{ rateType: 'hourly', ratePhp, count: hours }] };
}

// ponytail: measured from the quote's created_at, not approval time; add
// an approved_at column if drafting and approving drift apart.
export const QUOTE_VALID_DAYS = 7;

export function quoteExpiresAt(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + QUOTE_VALID_DAYS * 86_400_000);
}
