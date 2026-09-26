// Lives in packages/shared, same convention as document-intelligence-port.ts
// and weather-port.ts: browser-safe (no Node builtins -- apps/web imports
// @arkilaunch/shared too), so the port contract and stub adapter can be
// shared without pulling apps/api's internals in. The real PayMongo HTTP
// adapter and its HMAC signature verification live in apps/api (they need
// node:crypto and env-scoped secrets), see apps/api/src/ports/payments.port.ts.

export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
}

// PRD-F2 (PayMongo Payment Interface). The platform stores no card/bank
// data (AGENTS.md); this interface is what a webhook handler verifies
// against. `amountPhp` is in PHP (not centavos); the adapter converts to
// PayMongo's integer-centavo `amount` at the boundary.
// PayMongo checkout channel codes (all five accepted by a live test-mode
// POST /v1/checkout_sessions, 2026-09-26). The customer picks one on our
// page (Figma 168:2161 / 216:2049) and PayMongo's hosted page does the
// rest -- wallet login, bank login, OTP -- so no credential ever touches us.
export const CHECKOUT_METHODS = ['gcash', 'paymaya', 'qrph', 'dob', 'card'] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

export interface CheckoutOptions {
  label?: string;
  methods?: CheckoutMethod[];
  // The tenant's PayMongo child account (org_...): the net amount is
  // routed there with split_payment.transfer_to. Absent = collected on the
  // parent account (cr-arkilaunch-paymongo-linked-accounts.md).
  transferTo?: string;
  successUrl: string;
  cancelUrl: string;
}

// What PayMongo says about a session, asked server-to-server when the
// customer lands back on the success page.
export interface CheckoutSessionStatus {
  paid: boolean;
  paymentId?: string;
  amountCentavos?: number;
}

export interface PaymentsPort {
  createCheckoutSession(amountPhp: number, invoiceId: string, options: CheckoutOptions): Promise<CheckoutSession>;
  getCheckoutSession(sessionId: string): Promise<CheckoutSessionStatus>;
  refund(paymentId: string, amountPhp: number, reason: RefundReason): Promise<{ id: string }>;
}

export const REFUND_REASONS = ['requested_by_customer', 'duplicate', 'fraudulent', 'others'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export class StubPaymentsAdapter implements PaymentsPort {
  async createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession> {
    return { id: `stub_${invoiceId}`, checkoutUrl: `about:blank?amount=${amountPhp}` };
  }

  async getCheckoutSession(_sessionId: string): Promise<CheckoutSessionStatus> {
    return { paid: false };
  }

  async refund(paymentId: string): Promise<{ id: string }> {
    return { id: `stub_ref_${paymentId}` };
  }
}
