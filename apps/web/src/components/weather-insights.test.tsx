import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken, clearTokens } from '../lib/auth-client.js';
import { clearCart } from '../lib/cart-client.js';

// The weather panel beside the catalog, driven through the real route.
//
// The thing that needs watching: an unavailable forecast must READ as
// unavailable. A blank week or a row of zeros renders as five calm days,
// which is the failure mode weather-port.spec.ts exists to stop.

const SITE = {
  id: '22222222-2222-2222-2222-222222222222',
  customerId: '33333333-3333-3333-3333-333333333333',
  line1: 'Lot 4 Ortigas Ave',
  city: 'Pasig',
  province: 'Metro Manila',
  latitude: 14.58,
  longitude: 121.06,
};

const FORECAST = {
  siteId: SITE.id,
  fetchedAt: '2026-09-25T02:00:00.000Z',
  days: [
    { date: '2026-09-25', tempMaxC: 32.4, tempMinC: 25.1, windMaxKph: 18, precipMm: 0, code: 0 },
    { date: '2026-09-26', tempMaxC: 30, tempMinC: 24, windMaxKph: 22, precipMm: 8, code: 63 },
    { date: '2026-09-27', tempMaxC: 29, tempMinC: 24, windMaxKph: 40, precipMm: 30, code: 95 },
    { date: '2026-09-28', tempMaxC: 31, tempMinC: 25, windMaxKph: 15, precipMm: 1, code: 3 },
    { date: '2026-09-29', tempMaxC: 33, tempMinC: 26, windMaxKph: 12, precipMm: 0, code: 1 },
  ],
};

function stub({ forecastStatus = 200, sites = [SITE], reason = 'upstream_failed' } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const href = String(url);
      if (href.includes('/forecast')) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              forecastStatus === 200 ? FORECAST : { error: 'weather_unavailable', reason },
            ),
            { status: forecastStatus },
          ),
        );
      }
      if (href.includes('/me/sites')) {
        return Promise.resolve(new Response(JSON.stringify(sites), { status: 200 }));
      }
      if (href.includes('/users/me')) {
        return Promise.resolve(new Response(JSON.stringify({ tenantName: 'Almara' }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    }),
  );
}

describe('WeatherInsights', () => {
  beforeEach(() => {
    clearCart();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearTokens();
    clearCart();
  });

  it('shows the forecast for the customer site, named', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stub();
    const { unmount } = await renderRoute('/equipment');

    const rail = await screen.findByRole('complementary', { name: 'Weather insights' });
    await waitFor(() => expect(rail).toHaveTextContent('Weather insights'));
    await waitFor(() => expect(rail).toHaveTextContent('Thunderstorms'));
    expect(rail).toHaveTextContent('Rain');
    // Rounded, and never presented as a live reading.
    expect(rail).toHaveTextContent('32° / 25°');
    expect(rail).toHaveTextContent(/as of/i);
    // CC BY 4.0 obligation travels with the data.
    expect(rail).toHaveTextContent(/open-meteo/i);
    unmount();
  });

  it('reports an unavailable forecast rather than rendering a blank week', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stub({ forecastStatus: 503 });
    const { unmount } = await renderRoute('/equipment');

    const rail = await screen.findByRole('complementary', { name: 'Weather insights' });
    await waitFor(() => expect(rail).toHaveTextContent(/could not be fetched/i));
    // A transient failure DOES get a retry.
    expect(within(rail).getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(rail).not.toHaveTextContent('0° / 0°');
    unmount();
  });

  // A weather adapter switched off by configuration will never succeed, so a
  // Retry button there is one that cannot work.
  it('says weather is switched off rather than offering a retry that cannot work', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stub({ forecastStatus: 503, reason: 'flag_disabled' });
    const { unmount } = await renderRoute('/equipment');

    const rail = await screen.findByRole('complementary', { name: 'Weather insights' });
    await waitFor(() => expect(rail).toHaveTextContent(/switched off/i));
    expect(within(rail).queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    unmount();
  });

  it('asks a customer with no site to add one', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stub({ sites: [] });
    const { unmount } = await renderRoute('/equipment');

    const rail = await screen.findByRole('complementary', { name: 'Weather insights' });
    await waitFor(() => expect(rail).toHaveTextContent(/no project site yet/i));
    unmount();
  });

  // A visitor has no project site and no endpoint to read, so the panel would
  // be a permanent error box. The column is not reserved for it either -- an
  // empty 320px gap beside the catalog is worse than no column.
  it('renders nothing at all for a signed-out visitor', async () => {
    stub();
    const { unmount } = await renderRoute('/equipment');

    await screen.findByRole('heading', { name: /equipment for hire/i });
    expect(screen.queryByRole('complementary', { name: 'Weather insights' })).not.toBeInTheDocument();
    unmount();
  });
});
