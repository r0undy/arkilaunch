import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// Quotes is the standard price book for every client; a booking's quote is
// only rebuilt here while the customer negotiates. The preview is the
// decision point, and it carries Create in its footer.

const EQUIPMENT_TYPE = { id: 'et-1', name: 'Excavator 20T' };
const RATE_CARD = { id: 'rc-1', equipmentTypeId: 'et-1', equipmentId: null, rateType: 'daily', currency: 'PHP', rateValue: '20000' };
const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING = {
  id: BOOKING_ID, status: 'pending', projectSiteId: 'site-1', customerId: 'cust-1',
  items: [{ equipmentId: 'eq-1', start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z', status: 'reserved' }],
  quotation: { id: 'quote-0', revision: 1, status: 'approved', totalPhp: 53000, createdAt: '2026-09-27T00:00:00Z', inNegotiation: true },
};

const PREVIEW = {
  status: 'draft',
  dieselPrice: 62.4,
  dieselPriceDate: '2026-09-20',
  priceStale: false,
  lineItems: [
    {
      kind: 'equipment', equipmentTypeId: 'et-1', rateCardId: 'rc-1', quantity: 1, estimatedHours: 8,
      rentParts: [{ rateType: 'daily', ratePhp: 20000, count: 1 }], rent: 20000, hourlyRate: 2500,
      operatingCost: 20000, buffer: 0, subtotal: 20000,
    },
    { kind: 'custom', description: 'Operator overtime', equipmentTypeId: null, rateCardId: null, quantity: 2, estimatedHours: 0, rentParts: [], rent: 0, hourlyRate: 0, operatingCost: 0, buffer: 0, subtotal: 3000 },
  ],
  mobilization: 15000,
  demobilization: 15000,
  subtotal: 53000,
  discount: 0,
  total: 53000,
};

function stubFetch(onQuotes?: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const json = (v: unknown) =>
        Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/reference/equipment-types')) return json([EQUIPMENT_TYPE]);
      if (u.includes('/reference/rate-cards')) return json([RATE_CARD]);
      if (u.includes('/pricing/billing-settings')) return json({ dailyHours: 8, minDepositPhp: 0, lowBalancePct: 20, depositPct: 0, mobilizationPhp: 15000, demobilizationPhp: 12000, minHours: 0 });
      if (u.includes('/pricing/parameters')) return json(null);
      if (u.includes('/pricing/diesel-price')) return json(null);
      if (u.includes('/rate-cards')) return json({ items: [], total: 0 });
      if (u.includes('/truck-settings')) return json({ baseFeePhp: 2500, driverFeePhp: 1500, extras: [], formula: null, rangePct: 10, region: 'NCR' });
      if (u.includes('/toll-rates')) return json([]);
      if (u.includes(`/bookings/${BOOKING_ID}`)) return json(BOOKING);
      if (u.includes('/quotes/quote-0')) return json({ ...PREVIEW, id: 'quote-0', status: 'approved' });
      if (u.includes('/quotes')) {
        if (onQuotes) return Promise.resolve(onQuotes(u));
        return json(u.endsWith('/preview') ? PREVIEW : { ...PREVIEW, id: 'quote-1' });
      }
      return json([]);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Quotes', () => {
  it('is the standard price book: rental with its fixed mob/demob, trucking in its own tab', async () => {
    stubFetch();
    await renderRoute('/app/quotes');

    expect(await screen.findByRole('tab', { name: 'Equipment rental' })).toHaveAttribute('aria-selected', 'true');
    // No quote is drawn up per company any more.
    expect(screen.queryByLabelText('Customer')).not.toBeInTheDocument();
    // Read at a glance on the card; the inputs are one Edit away, in a modal.
    const fees = await screen.findByRole('group', { name: 'Mobilization and demobilization' });
    expect(fees).toHaveTextContent(/15,000/);
    await userEvent.click(screen.getByRole('button', { name: 'Edit mobilization fees' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mobilization and demobilization' });
    expect(within(dialog).getByLabelText('Mobilization (PHP)')).toHaveValue(15000);
    expect(within(dialog).getByLabelText('Demobilization (PHP)')).toHaveValue(12000);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('tab', { name: 'Trucking' }));
    expect(await screen.findByRole('heading', { name: 'Customer quotation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Negotiation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Internal trip cost' })).toBeInTheDocument();
    // Mob/demob is rental only.
    expect(screen.queryByLabelText('Mobilization (PHP)')).not.toBeInTheDocument();
  });

  it('revises a booking in negotiation: preview over the form, draft from its footer', async () => {
    stubFetch();
    await renderRoute(`/app/quotes?bookingId=${BOOKING_ID}`);

    expect(await screen.findByRole('heading', { name: 'Revise quote' })).toBeInTheDocument();
    // Transport is the price book's, not set per quote.
    expect(screen.queryByLabelText('Mobilization (PHP)')).not.toBeInTheDocument();

    const priceIt = await screen.findByRole('button', { name: 'Preview price' });
    await waitFor(() => expect(priceIt).toBeEnabled());
    await userEvent.click(priceIt);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Excavator 20T');
    expect(dialog).toHaveTextContent('/day × 1 day');
    expect(dialog).toHaveTextContent('Operator overtime');
    expect(dialog).toHaveTextContent('Mobilization');
    expect(dialog).toHaveTextContent('53000.00');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Revised quote drafted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('reports a rejected quote as a sentence rather than a JSON dump', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'rate_card_expired' }), { status: 400 }));
    await renderRoute(`/app/quotes?bookingId=${BOOKING_ID}`);

    const priceIt = await screen.findByRole('button', { name: 'Preview price' });
    await waitFor(() => expect(priceIt).toBeEnabled());
    await userEvent.click(priceIt);

    expect(await screen.findByText('Could not price that quote')).toBeInTheDocument();
    expect(screen.getByText('Rate card expired.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
