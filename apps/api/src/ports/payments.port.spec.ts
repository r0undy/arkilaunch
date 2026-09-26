import { afterEach, describe, expect, it, vi } from 'vitest';
import { StubPaymentsAdapter } from '@arkilaunch/shared';
import { PayMongoAdapter, createPaymentsAdapter } from './payments.port.js';

// Offline: fetch is stubbed. Pins the request shape verified against the
// live test-mode API (cr-arkilaunch-paymongo-linked-accounts.md).
describe('PayMongoAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('creates a session that routes the money to the tenant child account', async () => {
    const fetchMock = stubFetch({ data: { id: 'cs_1', attributes: { checkout_url: 'https://checkout.paymongo.com/1' } } });
    const session = await new PayMongoAdapter('sk_test_x').createCheckoutSession(1234.56, 'inv-1', {
      label: 'Rental deposit',
      methods: ['gcash'],
      transferTo: 'org_child',
      successUrl: 'https://almara.example.com/account/checkout/success?invoice=inv-1',
      cancelUrl: 'https://almara.example.com/account/checkout/failed?invoice=inv-1',
    });

    expect(session).toEqual({ id: 'cs_1', checkoutUrl: 'https://checkout.paymongo.com/1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.paymongo.com/v1/checkout_sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('sk_test_x:').toString('base64')}`);
    const attrs = JSON.parse(init.body as string).data.attributes;
    expect(attrs.line_items[0].amount).toBe(123456);
    expect(attrs.payment_method_types).toEqual(['gcash']);
    expect(attrs.split_payment).toEqual({ transfer_to: 'org_child' });
    expect(attrs.metadata).toEqual({ invoice_id: 'inv-1' });
    expect(attrs.success_url).toContain('almara.example.com');
  });

  it('reads a paid session as paid with its pay_ id and amount, an open one as unpaid', async () => {
    stubFetch({ data: { attributes: { payments: [{ id: 'pay_1', attributes: { status: 'paid', amount: 500 } }] } } });
    expect(await new PayMongoAdapter('sk_test_x').getCheckoutSession('cs_1')).toEqual({
      paid: true,
      paymentId: 'pay_1',
      amountCentavos: 500,
    });
    stubFetch({ data: { attributes: { payments: [] } } });
    expect(await new PayMongoAdapter('sk_test_x').getCheckoutSession('cs_1')).toEqual({ paid: false });
  });

  it('refuses to boot with payments on but a secret missing', () => {
    vi.stubEnv('ENABLE_PAYMENTS', 'true');
    vi.stubEnv('PAYMONGO_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('PAYMONGO_WEBHOOK_SECRET', '');
    expect(() => createPaymentsAdapter()).toThrow(/PAYMONGO_WEBHOOK_SECRET/);
    vi.stubEnv('PAYMONGO_WEBHOOK_SECRET', 'whsk_x');
    expect(createPaymentsAdapter()).toBeInstanceOf(PayMongoAdapter);
    vi.stubEnv('ENABLE_PAYMENTS', 'false');
    expect(createPaymentsAdapter()).toBeInstanceOf(StubPaymentsAdapter);
  });
});
