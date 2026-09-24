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

export const QuoteItemInputSchema = z.object({
  equipmentTypeId: z.string().uuid(),
  quantity: z.number().int().min(1),
  rateCardId: z.string().uuid(),
  estimatedHours: z.number().finite().min(0),
  mobilizationKm: z.number().finite().min(0),
  demobilizationKm: z.number().finite().min(0),
  // Negotiation: staff-agreed price for this line, replacing the computed
  // subtotal on this quote only (stored in pricing_inputs, audit-logged).
  agreedSubtotalPhp: z.number().finite().min(0).max(99_999_999.99).optional(),
});
export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;

export const QuoteRequestSchema = z.object({
  customerId: z.string().uuid(),
  projectSiteId: z.string().uuid(),
  // The booking this quote prices. Optional so a quote can still be drawn
  // up cold; a customer can only accept one that is tied to a booking.
  rentalId: z.string().uuid().optional(),
  discount: DiscountSchema,
  items: z.array(QuoteItemInputSchema).min(1),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

// How long a customer has to accept an approved quote before its diesel
// snapshot and rates are too old to honour. Shared so the accept button
// and the server refuse on the same day.
// ponytail: measured from the quote's created_at, not approval time; add
// an approved_at column if drafting and approving drift apart.
export const QUOTE_VALID_DAYS = 7;

export function quoteExpiresAt(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + QUOTE_VALID_DAYS * 86_400_000);
}
