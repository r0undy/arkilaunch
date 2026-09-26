import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// The Quotes tab is the standard pricing every client pays
// (docs/cr-arkilaunch-standard-pricing.md): no per-company builder, the
// inputs grouped by the service they price, and the fixed mobilization /
// demobilization saved as tenant settings rather than typed per quote.

const BILLING = { dailyHours: 8, minDepositPhp: 5000, lowBalancePct: 20, depositPct: 0, mobilizationPhp: 15000, demobilizationPhp: 12000, minHours: 0 };
const PARAMS = {
  region: 'NCR', operatorHourlyPhp: '150.00', maintenanceHourlyPhp: '80.00', bufferPct: '0.1000', fuelLPerHour: '10.000',
  fuelLPerKm: '0.300', transportPhpPerKm: '45.00', dieselOverridePhp: null,
};
const TRUCK = { baseFeePhp: 2000, driverFeePhp: 800, extras: [], formula: null, rangePct: 10, region: 'NCR' };

let calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/pricing/billing-settings')) return json(BILLING);
      if (u.includes('/pricing/parameters')) return json(PARAMS);
      if (u.includes('/pricing/diesel-price')) return json(null);
      if (u.includes('/truck-settings')) return json(TRUCK);
      if (u.includes('/rate-cards')) return json({ items: [], total: 0 });
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

describe('Quotes (standard pricing)', () => {
  it('groups the inputs by service and has no per-company builder', async () => {
    stubFetch();
    await renderRoute('/app/quotes');

    expect(await screen.findByRole('heading', { name: 'Equipment rental' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trucking' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Mobilization (PHP)')).toHaveValue(15000);
    expect(screen.getByLabelText('Demobilization (PHP)')).toHaveValue(12000);
    expect(await screen.findByLabelText('Transport (PHP per km)')).toHaveValue(45);
    expect(screen.queryByLabelText(/customer/i)).not.toBeInTheDocument();
  });

  it('saves mobilization as the fixed tenant fee, keeping the other billing settings', async () => {
    stubFetch();
    await renderRoute('/app/quotes');

    const mob = await screen.findByLabelText('Mobilization (PHP)');
    await userEvent.clear(mob);
    await userEvent.type(mob, '18000');
    const section = mob.closest('[aria-label="Mobilization and demobilization"]') as HTMLElement;
    await userEvent.click(section.querySelector('button')!);

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/pricing/billing-settings'))).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ ...BILLING, mobilizationPhp: 18000, demobilizationPhp: 12000 });
  });
});
