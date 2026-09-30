// The real adapter lives here, not in packages/shared: it needs fetch and an env secret, no place in a browser bundle.
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

// ArkiLaunch's key is the PayMongo parent; each session routes its net amount to the tenant's child account.
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
    const name = options.bookingCode ? `${options.bookingCode} · ${label}` : label;
    const body = await this.call<{ data: { id: string; attributes: { checkout_url: string } } }>('POST', '/checkout_sessions', {
      line_items: [
        {
          amount: Math.round(amountPhp * 100),
          currency: 'PHP',
          description: `${name} (invoice ${invoiceId})`,
          name,
          quantity: 1,
        },
      ],
      payment_method_types: options.methods ?? [...CHECKOUT_METHODS],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      description: `${name} for invoice ${invoiceId}`,
      // Rides onto the payment PayMongo creates, so payment.* webhooks resolve our invoice.
      metadata: { invoice_id: invoiceId, ...(options.bookingCode ? { booking_code: options.bookingCode } : {}) },
      ...(options.transferTo ? { split_payment: { transfer_to: options.transferTo } } : {}),
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

  async expireCheckoutSession(sessionId: string): Promise<void> {
    await this.call('POST', `/checkout_sessions/${encodeURIComponent(sessionId)}/expire`);
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

// On, it refuses to boot without both secrets: a half-configured path would take customers to an unverifiable checkout.
export function createPaymentsAdapter(): PaymentsPort {
  if (process.env.ENABLE_PAYMENTS !== 'true') return new StubPaymentsAdapter();
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey || !process.env.PAYMONGO_WEBHOOK_SECRET) {
    throw new Error('ENABLE_PAYMENTS=true requires PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET');
  }
  return new PayMongoAdapter(secretKey);
}
