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
// against. `amountPhp` is the deposit amount in PHP (not centavos); the
// adapter converts to PayMongo's integer-centavo `amount` at the boundary.
// PayMongo checkout channel codes. The customer picks one on our page
// (Figma 168:2161 / 216:2049) and PayMongo's hosted page does the rest --
// wallet login, bank login, OTP -- so no credential ever touches us.
export const CHECKOUT_METHODS = ['gcash', 'paymaya', 'dob', 'card'] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

export interface CheckoutOptions {
  label?: string;
  methods?: CheckoutMethod[];
}

export interface PaymentsPort {
  createCheckoutSession(amountPhp: number, invoiceId: string, options?: CheckoutOptions): Promise<CheckoutSession>;
}

export class StubPaymentsAdapter implements PaymentsPort {
  async createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession> {
    return { id: `stub_${invoiceId}`, checkoutUrl: `about:blank?amount=${amountPhp}` };
  }
}
