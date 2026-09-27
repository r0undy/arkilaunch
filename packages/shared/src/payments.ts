import { z } from 'zod';
import { CHECKOUT_METHODS, REFUND_REASONS } from './payments-port.js';

// PayMongo webhook event envelope (PRD-F2). Every PayMongo resource (and
// the event wrapping it) uses a `{ id, type, attributes }` envelope; the
// event's `attributes.type` is the event name and `attributes.data` the
// affected resource in the same shape.
//
// The events the handler acts on, confirmed by subscribing a webhook and
// paying/refunding a live test-mode checkout on 2026-09-26
// (cr-arkilaunch-paymongo-linked-accounts.md). POST /v1/webhooks rejects
// `refund.succeeded` and `dispute.*` as invalid event types, so the names
// the f2-f8 CR carried were never deliverable.
//   checkout_session.payment.paid  resource = the checkout session (our provider_ref),
//                                  with payments[] (pay_ id, amount) and our metadata
//   payment.failed                 resource = the payment, with our metadata
//   payment.refund.updated         resource = the refund (ref_ id, payment_id, status)
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

// Coupons (cr-arkilaunch-coupons.md). Codes compare upper-case; the same
// shape is the DB's coupons_code_chk.
export const CouponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/);

// POST /bookings/:id/checkout body. Optional so the old empty-body call
// keeps working and PayMongo offers every channel.
export const CheckoutRequestSchema = z.object({
  method: z.enum(CHECKOUT_METHODS).optional(),
  // Pay at the office: issues the invoice without a PayMongo session. Staff
  // record the cash receipt by hand (CR truck-booking-and-kyc-docs).
  cash: z.boolean().optional(),
  // A rental company's coupon (cr-arkilaunch-coupons.md). The server
  // prices it; the client only names the code.
  couponCode: CouponCodeSchema.optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

// POST /payments/:id/refund (staff). No amount = the whole payment.
export const RefundRequestSchema = z.object({
  amountPhp: z.number().positive().optional(),
  reason: z.enum(REFUND_REASONS),
});
export type RefundRequest = z.infer<typeof RefundRequestSchema>;

// POST /invoices/:id/amount (staff): lower an unpaid checkout invoice.
// PHP 1.00 is PayMongo's smallest checkout total; a reason is audit-logged.
export const InvoiceAmountUpdateSchema = z.object({
  amountPhp: z.number().finite().min(1).max(99_999_999.99),
  reason: z.string().trim().min(3).max(200),
});
export type InvoiceAmountUpdate = z.infer<typeof InvoiceAmountUpdateSchema>;

// PATCH /tenants/:id/paymongo-account (platform admin). null unlinks.
export const PaymongoAccountUpdateSchema = z.object({
  accountId: z
    .string()
    .trim()
    .regex(/^org_[A-Za-z0-9]+$/)
    .nullable(),
});
export type PaymongoAccountUpdate = z.infer<typeof PaymongoAccountUpdateSchema>;

// POST /coupons (staff). A percent coupon is at most 100.
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

// PATCH /coupons/:id (staff). A code is never edited once issued, only switched off or on.
export const CouponUpdateSchema = z.object({ active: z.boolean() });
export type CouponUpdate = z.infer<typeof CouponUpdateSchema>;

// POST /bookings/:id/coupon (customer): what the code would take off.
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

// GET /coupons: newest first, paged.
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
