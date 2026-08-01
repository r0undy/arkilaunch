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
});
export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;

export const QuoteRequestSchema = z.object({
  customerId: z.string().uuid(),
  projectSiteId: z.string().uuid(),
  discount: DiscountSchema,
  items: z.array(QuoteItemInputSchema).min(1),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
