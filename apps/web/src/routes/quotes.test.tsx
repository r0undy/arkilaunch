import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// Preview and Create draft used to be two sibling buttons under a long form,
// with the priced result printed below it: you committed to a draft without
// the figures necessarily on screen, and a failure arrived as a JSON dump.
// The preview is now the decision point, and it carries Create in its footer.

const CUSTOMER = { id: '11111111-1111-4111-8111-111111111111', companyName: 'Almara Construction' };
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';
// The builder only opens from a booking under negotiation.
const BUILDER_URL = `/app/quotes?bookingId=${BOOKING_ID}&customerId=${CUSTOMER.id}`;
const EQUIPMENT_TYPE = { id: 'et-1', name: 'Excavator 20T' };
const RATE_CARD = { id: 'rc-1', equipmentTypeId: 'et-1', equipmentId: null, rateType: 'daily', currency: 'PHP', rateValue: '20000' };
const SITE = { id: 'site-1', city: 'Taguig', province: 'NCR', latitude: 14.5, longitude: 121 };

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
      if (u.includes('/reference/customers')) return json([CUSTOMER]);
      if (u.includes('/reference/equipment-types')) return json([EQUIPMENT_TYPE]);
      if (u.includes('/reference/rate-cards')) return json([RATE_CARD]);
      if (u.includes('/reference/project-sites')) return json([SITE]);
      if (u.includes(`/bookings/${BOOKING_ID}`)) return json({ id: BOOKING_ID, projectSiteId: SITE.id, items: [], quotation: null });
      if (u.includes('/rate-cards')) return json({ items: [{ ...RATE_CARD, sizeClass: 'medium', effectiveFrom: '2026-09-01T00:00:00Z', effectiveTo: null }], total: 1 });
      if (u.includes('/pricing/billing-settings')) return json({ mobilizationPhp: 15000, demobilizationPhp: 15000, dailyHours: 8 });
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
  it('shows the fixed price book, not a per-company builder', async () => {
    stubFetch();
    await renderRoute('/app/quotes');

    expect(await screen.findByText('Excavator 20T, Medium (15-30 t)')).toBeInTheDocument();
    expect(screen.getByText('Mobilization and demobilization (equipment rental)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview price' })).not.toBeInTheDocument();
  });

  it('opens the priced quote over the form, and creates the draft from its footer', async () => {
    stubFetch();
    await renderRoute(BUILDER_URL);

    const priceIt = await screen.findByRole('button', { name: 'Preview price' });
    await waitFor(() => expect(priceIt).toBeEnabled());
    await userEvent.click(priceIt);

    const dialog = await screen.findByRole('dialog');
    // The machine being priced reads by name; the column used to print a
    // slice of its UUID.
    expect(dialog).toHaveTextContent('Excavator 20T');
    // Charged in the card's own unit, the same way the customer reads it.
    expect(dialog).toHaveTextContent('/day × 1 day');
    expect(dialog).toHaveTextContent('Operator overtime');
    expect(dialog).toHaveTextContent('Mobilization');
    expect(dialog).toHaveTextContent('53000.00');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    // The draft is acknowledged and the dialog gets out of the way.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Draft quote created')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('reports a rejected quote as a sentence rather than a JSON dump', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'rate_card_expired' }), { status: 400 }));
    await renderRoute(BUILDER_URL);

    const priceIt = await screen.findByRole('button', { name: 'Preview price' });
    await waitFor(() => expect(priceIt).toBeEnabled());
    await userEvent.click(priceIt);

    expect(await screen.findByText('Could not price that quote')).toBeInTheDocument();
    expect(screen.getByText('Rate card expired.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
