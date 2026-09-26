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

// POST /bookings/:id/checkout body. Optional so the old empty-body call
// keeps working and PayMongo offers every channel.
export const CheckoutRequestSchema = z.object({
  method: z.enum(CHECKOUT_METHODS).optional(),
  // Pay at the office: issues the invoice without a PayMongo session. Staff
  // record the cash receipt by hand (CR truck-booking-and-kyc-docs).
  cash: z.boolean().optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

// POST /payments/:id/refund (staff). No amount = the whole payment.
export const RefundRequestSchema = z.object({
  amountPhp: z.number().positive().optional(),
  reason: z.enum(REFUND_REASONS),
});
export type RefundRequest = z.infer<typeof RefundRequestSchema>;

// PATCH /tenants/:id/paymongo-account (platform admin). null unlinks.
export const PaymongoAccountUpdateSchema = z.object({
  accountId: z
    .string()
    .trim()
    .regex(/^org_[A-Za-z0-9]+$/)
    .nullable(),
});
export type PaymongoAccountUpdate = z.infer<typeof PaymongoAccountUpdateSchema>;
