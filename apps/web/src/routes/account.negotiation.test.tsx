import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '55555555-5555-4555-8555-555555555555';
const BOOKING = {
  id: BOOKING_ID,
  code: 'EQR-2026-0001',
  status: 'confirmed',
  items: [],
  quotation: { id: QUOTE_ID, revision: 2, status: 'accepted', totalPhp: 100000, createdAt: '2026-09-02T00:00:00Z' },
  deposit: { required: 20000, totalDeducted: 0, deductions: [] },
  invoices: [{ id: 'inv-1', invoiceType: 'deposit', status: 'paid', amount: 20000 }],
  payments: [],
  changeRequests: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Negotiation finalised', () => {
  it('does not add a deposit that is already paid to the total due', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url);
        const body = u.includes(`/bookings/${BOOKING_ID}`)
          ? BOOKING
          : u.includes(`/quotes/${QUOTE_ID}`)
            ? { id: QUOTE_ID, revision: 2, total: 100000, createdAt: '2026-09-02T00:00:00Z', lineItems: [] }
            : [];
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    await renderRoute(`/account/negotiation/${BOOKING_ID}/final`);

    expect((await screen.findAllByText('₱100,000.00')).length).toBeGreaterThan(0);
    expect(screen.queryByText('₱120,000.00')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proceed to payment' })).toBeInTheDocument();
    expect(document.querySelector('a button')).toBeNull();
  });
});
