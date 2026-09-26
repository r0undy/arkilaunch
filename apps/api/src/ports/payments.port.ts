// Canonical port + stub adapter live in packages/shared so a browser bundle
// (apps/web) can share the contract without pulling Node builtins (same
// convention as document-intelligence.port.ts). The real adapter lives
// here: it needs `fetch` against a live endpoint and an env-scoped secret,
// which have no place in a browser-shared package.
import {
  CHECKOUT_METHODS,
  StubPaymentsAdapter,
  type CheckoutOptions,
  type CheckoutSession,
  type CheckoutSessionStatus,
  type PaymentsPort,
  type RefundReason,
} from '@arkilaunch/shared';

const PAYMONGO_API_BASE = 'https://api.paymongo.com/v1';

// Real PayMongo Hosted Checkout adapter (PRD-F2). Every request/response
// shape below was exercised against the live test-mode API on 2026-09-26
// (cr-arkilaunch-paymongo-linked-accounts.md §Findings): the
// {data:{attributes}} envelope, the five channel codes, metadata copied
// onto the payment intent and payment, GET returning `payments[]`, and
// POST /v1/refunds. ArkiLaunch's key is the PayMongo *parent*; each
// session routes its net amount to the tenant's child account with
// split_payment.transfer_to.
export class PayMongoAdapter implements PaymentsPort {
  constructor(private readonly secretKey: string) {}

  private async call<T>(method: 'GET' | 'POST', path: string, attributes?: unknown): Promise<T> {
    const response = await fetch(`${PAYMONGO_API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      },
      ...(attributes ? { body: JSON.stringify({ data: { attributes } }) } : {}),
    });
    if (!response.ok) {
      throw new Error(`PayMongo ${method} ${path} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  async createCheckoutSession(amountPhp: number, invoiceId: string, options: CheckoutOptions): Promise<CheckoutSession> {
    const label = options.label ?? 'Rental deposit';
    const body = await this.call<{ data: { id: string; attributes: { checkout_url: string } } }>('POST', '/checkout_sessions', {
      line_items: [
        {
          amount: Math.round(amountPhp * 100),
          currency: 'PHP',
          description: `${label} (invoice ${invoiceId})`,
          name: label,
          quantity: 1,
        },
      ],
      // The customer's pick from our method screen, else every channel.
      payment_method_types: options.methods ?? [...CHECKOUT_METHODS],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      description: `${label} for invoice ${invoiceId}`,
      // Rides onto the payment PayMongo creates, so payment.* webhooks
      // resolve our invoice (verified on a live test payment).
      metadata: { invoice_id: invoiceId },
      split_payment: { transfer_to: options.transferTo },
    });
    return { id: body.data.id, checkoutUrl: body.data.attributes.checkout_url };
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSessionStatus> {
    const body = await this.call<{
      data: { attributes: { payments: { id: string; attributes: { status: string; amount: number } }[] } };
    }>('GET', `/checkout_sessions/${encodeURIComponent(sessionId)}`);
    const paid = body.data.attributes.payments.find((p) => p.attributes.status === 'paid');
    return paid ? { paid: true, paymentId: paid.id, amountCentavos: paid.attributes.amount } : { paid: false };
  }

  async refund(paymentId: string, amountPhp: number, reason: RefundReason): Promise<{ id: string }> {
    const body = await this.call<{ data: { id: string } }>('POST', '/refunds', {
      amount: Math.round(amountPhp * 100),
      payment_id: paymentId,
      reason,
    });
    return { id: body.data.id };
  }
}

// ENABLE_PAYMENTS defaults off (stub). On, it refuses to boot without both
// secrets -- same posture as the OCR flags: a half-configured payment path
// would take a customer to a checkout whose webhook can never be verified.
export function createPaymentsAdapter(): PaymentsPort {
  if (process.env.ENABLE_PAYMENTS !== 'true') return new StubPaymentsAdapter();
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey || !process.env.PAYMONGO_WEBHOOK_SECRET) {
    throw new Error('ENABLE_PAYMENTS=true requires PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET');
  }
  return new PayMongoAdapter(secretKey);
}
