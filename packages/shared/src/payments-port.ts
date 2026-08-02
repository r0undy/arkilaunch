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
export interface PaymentsPort {
  createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession>;
}

export class StubPaymentsAdapter implements PaymentsPort {
  async createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession> {
    return { id: `stub_${invoiceId}`, checkoutUrl: `about:blank?amount=${amountPhp}` };
  }
}
