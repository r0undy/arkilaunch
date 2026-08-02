import { z } from 'zod';

// PayMongo webhook event envelope (PRD-F2), verified 2026-08-02 against
// docs.paymongo.com/reference/webhook-resource +
// docs.paymongo.com/docs/developer-tools-webhooks-events. Every PayMongo
// resource (and the event wrapping it) uses this `{ id, type, attributes }`
// envelope shape; the event's own `attributes.type` is the event name
// (e.g. "payment.paid"), and `attributes.data` is the nested affected
// resource (a Payment, Refund, or Dispute), itself in the same envelope
// shape.
//
// cr-arkilaunch-f2-f8-bookings-payments.md: the actual event names differ
// from the SDD §4 sketch. Confirmed names this pass handles:
//   payment.paid, payment.failed   (SDD sketch matched these)
//   refund.succeeded               (SDD sketch said "refund.updated" -- wrong)
//   dispute.created, dispute.resolved (SDD sketch said a single "dispute" event -- wrong)
export const PaymongoEventTypeSchema = z.enum([
  'payment.paid',
  'payment.failed',
  'refund.succeeded',
  'dispute.created',
  'dispute.resolved',
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
      type: z.string(), // validated against PaymongoEventTypeSchema by the handler, not here (unknown event types are logged, not rejected)
      livemode: z.boolean(),
      data: PaymongoResourceSchema,
    }),
  }),
});
export type PaymongoEventEnvelope = z.infer<typeof PaymongoEventEnvelopeSchema>;
