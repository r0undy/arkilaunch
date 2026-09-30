import { z } from 'zod';
import { CHECKOUT_METHODS, REFUND_REASONS } from './payments-port.js';

// Only these event names are deliverable: POST /v1/webhooks rejects refund.succeeded and dispute.*.
export const PaymongoEventTypeSchema = z.enum([
  'checkout_session.payment.paid',
  'payment.failed',
  'payment.refund.updated',
]);
export type PaymongoEventType = z.infer<typeof PaymongoEventTypeSchema>;

const PaymongoResourceSchema = z.object({
  id: z.string(),
  type: z.string(),
  attributes: z.record(z.string(), z.unknown()),
});

export const PaymongoEventEnvelopeSchema = z.object({
  data: z.object({
    id: z.string(),
    type: z.literal('event'),
    attributes: z.object({
      type: z.string(), // unknown event types are logged, not rejected
      livemode: z.boolean(),
      data: PaymongoResourceSchema,
    }),
  }),
});
export type PaymongoEventEnvelope = z.infer<typeof PaymongoEventEnvelopeSchema>;

// Codes compare upper-case, matching the DB's coupons_code_chk.
export const CouponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/);

export const CheckoutRequestSchema = z.object({
  method: z.enum(CHECKOUT_METHODS).optional(),
  cash: z.boolean().optional(),
  // The server prices it; the client only names the code.
  couponCode: CouponCodeSchema.optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const RefundRequestSchema = z.object({
  amountPhp: z.number().positive().optional(),
  reason: z.enum(REFUND_REASONS),
});
export type RefundRequest = z.infer<typeof RefundRequestSchema>;

// PHP 1.00 is PayMongo's smallest checkout total.
export const InvoiceAmountUpdateSchema = z.object({
  amountPhp: z.number().finite().min(1).max(99_999_999.99),
  reason: z.string().trim().min(3).max(200),
});
export type InvoiceAmountUpdate = z.infer<typeof InvoiceAmountUpdateSchema>;

export const PaymongoAccountUpdateSchema = z.object({
  accountId: z
    .string()
    .trim()
    .regex(/^org_[A-Za-z0-9]+$/)
    .nullable(),
});
export type PaymongoAccountUpdate = z.infer<typeof PaymongoAccountUpdateSchema>;

export const CouponCreateSchema = z
  .object({
    code: CouponCodeSchema,
    discountType: z.enum(['percent', 'fixed']),
    discountValue: z.number().positive().max(10_000_000),
    expiresAt: z.coerce.date().nullable().optional(),
    maxUses: z.number().int().positive().nullable().optional(),
    oncePerCustomer: z.boolean().default(false),
  })
  .refine((c) => c.discountType !== 'percent' || c.discountValue <= 100, {
    path: ['discountValue'],
    message: 'A percent coupon is at most 100',
  });
export type CouponCreate = z.infer<typeof CouponCreateSchema>;

export const CouponUpdateSchema = z.object({ active: z.boolean() });
export type CouponUpdate = z.infer<typeof CouponUpdateSchema>;

export const CouponPreviewRequestSchema = z.object({ code: CouponCodeSchema });
export type CouponPreviewRequest = z.infer<typeof CouponPreviewRequestSchema>;

export interface CouponResponse {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  expiresAt: string | null;
  maxUses: number | null;
  oncePerCustomer: boolean;
  redeemedCount: number;
  active: boolean;
  createdAt: string;
}

export interface CouponListResponse {
  items: CouponResponse[];
  total: number;
}

export interface CouponPreviewResponse {
  code: string;
  discountPhp: number;
  rentPhp: number;
  depositPhp: number;
  totalPhp: number;
}
