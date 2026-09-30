import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken, clearTokens } from '../lib/auth-client.js';
import { addToCart, clearCart, defaultRentalWindow } from '../lib/cart-client.js';

const PRICED = { id: '11111111-1111-1111-1111-111111111111', model: 'JCB 3CX', rateValue: 1500 };
const UNPRICED = { id: '22222222-2222-2222-2222-222222222222', model: 'CAT 320D', rateValue: null };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const href = String(url);
      if (href.includes('/availability')) return Promise.resolve(new Response('{}', { status: 500 }));
      const body = href.includes('/users/me')
        ? { tenantName: 'Almara' }
        : href.includes('/me/companies')
          ? [{ id: 'c1', companyName: 'Acme', kycStatus: 'approved' }]
          : href.includes('sites')
            ? []
            : { items: [PRICED, UNPRICED] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

describe('/account/cart cost summary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
    clearCart();
  });

  it('breaks the cost down per machine when the cart holds several', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => {
      addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow() });
      addToCart({ equipmentId: UNPRICED.id, model: UNPRICED.model, ...defaultRentalWindow() });
    });
    const { unmount } = await renderRoute('/account/cart');

    const list = await screen.findByRole('list', { name: 'Cost per machine' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(await within(rows[0]!).findByText(/₱/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Priced in quote')).toBeInTheDocument();
    unmount();
  });

  it('keeps the plain summary for a single machine', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow() }));
    const { unmount } = await renderRoute('/account/cart');

    await screen.findByRole('heading', { name: 'Cost summary' });
    expect(screen.queryByRole('list', { name: 'Cost per machine' })).not.toBeInTheDocument();
    unmount();
  });
});
