export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
}

// PayMongo hosted checkout (PRD-F2). The platform stores no card/bank data
// (AGENTS.md); this interface is what a webhook handler verifies against.
// Real adapter and signature verification land with the F2 slice.
export interface PaymentsPort {
  createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
}

export class StubPaymentsAdapter implements PaymentsPort {
  async createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession> {
    return { id: `stub_${invoiceId}`, checkoutUrl: `about:blank?amount=${amountPhp}` };
  }

  verifyWebhookSignature(): boolean {
    return false; // stub never accepts a webhook as authentic
  }
}
