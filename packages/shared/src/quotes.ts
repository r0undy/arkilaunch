import { z } from 'zod';

// RFC-3 §3/§6 boundary schemas, shared client/server. Reject NaN/Infinity/
// negative inputs before compute (RFC-3 §6); DB CHECK constraints backstop
// this at the storage layer.
export const DiscountSchema = z
  .object({
    type: z.enum(['none', 'percent', 'fixed']).default('none'),
    value: z.number().finite().min(0).default(0),
  })
  .default({ type: 'none', value: 0 });
export type Discount = z.infer<typeof DiscountSchema>;

const PhpAmount = z.number().finite().min(0).max(99_999_999.99);

// A catalog machine priced off its rate card. estimatedHours is the hire
// length in hours (days x the tenant's hours per day); the card's own unit
// decides how it is charged (rentFor).
export const EquipmentQuoteItemSchema = z.object({
  // Optional so older clients (and a line with no kind) mean equipment.
  kind: z.literal('equipment').optional(),
  equipmentTypeId: z.string().uuid(),
  quantity: z.number().int().min(1),
  rateCardId: z.string().uuid(),
  estimatedHours: z.number().finite().min(0),
  // Hire length in days, for daily and monthly cards; when set it wins
  // over estimatedHours (days x the tenant's hours per day).
  days: z.number().finite().min(0).max(3650).optional(),
  // Legacy per-km transport; mobilization is now a flat amount per quote.
  mobilizationKm: z.number().finite().min(0).default(0),
  demobilizationKm: z.number().finite().min(0).default(0),
  // Negotiation: staff-agreed price for this line, replacing the computed
  // subtotal on this quote only (stored in pricing_inputs, audit-logged).
  agreedSubtotalPhp: PhpAmount.optional(),
});

// Anything the admin prices by hand: an extra charge, a machine not in the
// catalog, operator overtime.
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
  // The booking this quote prices. Optional so a quote can still be drawn
  // up cold; a customer can only accept one that is tied to a booking.
  rentalId: z.string().uuid().optional(),
  discount: DiscountSchema,
  // Omitted: the company default from billing settings.
  mobilizationPhp: PhpAmount.optional(),
  demobilizationPhp: PhpAmount.optional(),
  items: z.array(QuoteItemInputSchema).min(1),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export type RentUnit = 'hourly' | 'daily' | 'monthly';
export const DAYS_PER_MONTH = 30;

// One "rate x count" piece of a line's rent, e.g. 8000/day x 12.
export interface RentPart {
  rateType: RentUnit;
  ratePhp: number;
  count: number;
}

// A machine's rent in its card's own unit. hours is the hire length in
// hours; daily and monthly cards turn it back into days. A monthly card
// charges whole months, then leftover days at the daily card if there is
// one, else pro-rated over 30 days (45 days = 1 month + 15 days).
export function rentFor(
  rateType: RentUnit,
  ratePhp: number,
  hours: number,
  dailyHours: number,
  dailyRatePhp: number | null = null,
): { rentPhp: number; parts: RentPart[] } {
  if (rateType === 'hourly') return { rentPhp: ratePhp * hours, parts: [{ rateType, ratePhp, count: hours }] };
  const days = hours / dailyHours;
  if (rateType === 'daily') return { rentPhp: ratePhp * days, parts: [{ rateType, ratePhp, count: days }] };
  const months = Math.floor(days / DAYS_PER_MONTH);
  const rest = days - months * DAYS_PER_MONTH;
  if (rest > 0 && dailyRatePhp !== null) {
    const parts: RentPart[] = [];
    if (months > 0) parts.push({ rateType, ratePhp, count: months });
    parts.push({ rateType: 'daily', ratePhp: dailyRatePhp, count: rest });
    return { rentPhp: months * ratePhp + rest * dailyRatePhp, parts };
  }
  const count = days / DAYS_PER_MONTH;
  return { rentPhp: ratePhp * count, parts: [{ rateType, ratePhp, count }] };
}

// How long a customer has to accept an approved quote before its diesel
// snapshot and rates are too old to honour. Shared so the accept button
// and the server refuse on the same day.
// ponytail: measured from the quote's created_at, not approval time; add
// an approved_at column if drafting and approving drift apart.
export const QUOTE_VALID_DAYS = 7;

export function quoteExpiresAt(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + QUOTE_VALID_DAYS * 86_400_000);
}
