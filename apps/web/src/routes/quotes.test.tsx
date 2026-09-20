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

const CUSTOMER = { id: 'cust-1', companyName: 'Almara Construction' };
const EQUIPMENT_TYPE = { id: 'et-1', name: 'Excavator 20T' };
const RATE_CARD = { id: 'rc-1', rateType: 'hourly', currency: 'PHP', rateValue: 2500 };
const SITE = { id: 'site-1', city: 'Taguig', province: 'NCR', latitude: 14.5, longitude: 121 };

const PREVIEW = {
  status: 'draft',
  dieselPrice: 62.4,
  dieselPriceDate: '2026-09-20',
  priceStale: false,
  lineItems: [
    { equipmentTypeId: 'et-1', quantity: 1, estimatedHours: 8, hourlyRate: 2500, subtotal: 20000 },
  ],
  subtotal: 20000,
  discount: 0,
  total: 20000,
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
  it('opens the priced quote over the form, and creates the draft from its footer', async () => {
    stubFetch();
    await renderRoute('/app/quotes');

    const priceIt = await screen.findByRole('button', { name: 'Preview price' });
    await waitFor(() => expect(priceIt).toBeEnabled());
    await userEvent.click(priceIt);

    const dialog = await screen.findByRole('dialog');
    // The machine being priced reads by name; the column used to print a
    // slice of its UUID.
    expect(dialog).toHaveTextContent('Excavator 20T');
    expect(dialog).toHaveTextContent('20000.00');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    // The draft is acknowledged and the dialog gets out of the way.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Draft quote created')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('reports a rejected quote as a sentence rather than a JSON dump', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'rate_card_expired' }), { status: 400 }));
    await renderRoute('/app/quotes');

    const priceIt = await screen.findByRole('button', { name: 'Preview price' });
    await waitFor(() => expect(priceIt).toBeEnabled());
    await userEvent.click(priceIt);

    expect(await screen.findByText('Could not price that quote')).toBeInTheDocument();
    expect(screen.getByText('Rate card expired.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
