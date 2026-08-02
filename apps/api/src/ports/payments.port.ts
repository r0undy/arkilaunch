// Canonical port + stub adapter live in packages/shared so a browser bundle
// (apps/web) can share the contract without pulling Node builtins (same
// convention as document-intelligence.port.ts). The real adapter lives
// here: it needs `fetch` against a live endpoint and an env-scoped secret,
// which have no place in a browser-shared package.
import { StubPaymentsAdapter, type CheckoutSession, type PaymentsPort } from '@arkilaunch/shared';

export { type CheckoutSession, type PaymentsPort, StubPaymentsAdapter } from '@arkilaunch/shared';

const PAYMONGO_API_BASE = 'https://api.paymongo.com/v1';

// Real PayMongo Hosted Checkout adapter (PRD-F2). Verified 2026-08-02
// against docs.paymongo.com/reference/create_checkout_sessions: request is
// POST /v1/checkout_sessions with a {data:{attributes:{...}}} envelope;
// response is {data:{id, attributes:{checkout_url}}}. `payment_method_types`
// channel codes below (card/gcash/paymaya/dob) are carried over from prior
// knowledge of the API, NOT independently re-verified against current docs
// this pass -- confirm before ever setting ENABLE_PAYMENTS=true against a
// live key (BUILD §3: "verify the exact API shape against current docs
// every time").
export class PayMongoAdapter implements PaymentsPort {
  constructor(
    private readonly secretKey: string,
    private readonly successUrl: string,
    private readonly cancelUrl: string,
  ) {}

  async createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession> {
    const amountCentavos = Math.round(amountPhp * 100);
    const response = await fetch(`${PAYMONGO_API_BASE}/checkout_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                amount: amountCentavos,
                currency: 'PHP',
                description: `Rental deposit (invoice ${invoiceId})`,
                name: 'Rental deposit',
                quantity: 1,
              },
            ],
            payment_method_types: ['card', 'gcash', 'paymaya', 'dob'],
            success_url: this.successUrl,
            cancel_url: this.cancelUrl,
            description: `Rental deposit for invoice ${invoiceId}`,
            // Correlates the eventual payment.paid/payment.failed webhook
            // back to our invoice -- PayMongo forwards checkout session
            // metadata onto the payment it creates (standard practice for
            // this style of hosted-checkout API; not independently
            // confirmed against a live payment-object schema this pass --
            // see the CR for the flagged assumption).
            metadata: { invoice_id: invoiceId },
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`PayMongo checkout session creation failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { data: { id: string; attributes: { checkout_url: string } } };
    return { id: body.data.id, checkoutUrl: body.data.attributes.checkout_url };
  }
}

// ENABLE_PAYMENTS defaults off; PayMongo keys are stubbed until they arrive
// (.env.example), the same stubbed-pending posture as Azure DI/Open-Meteo.
export function createPaymentsAdapter(): PaymentsPort {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  const successUrl = process.env.PAYMONGO_SUCCESS_URL;
  const cancelUrl = process.env.PAYMONGO_CANCEL_URL;
  if (process.env.ENABLE_PAYMENTS === 'true' && secretKey && successUrl && cancelUrl) {
    return new PayMongoAdapter(secretKey, successUrl, cancelUrl);
  }
  return new StubPaymentsAdapter();
}
