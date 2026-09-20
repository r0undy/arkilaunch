import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// The dashboard used to print every number the API had, stacked: a seven-row
// summary rail, a card listing every site, and three queues down the page.
// What it lost was hierarchy -- the one queue with a human decision attached
// was the third thing read. These cover the three pieces that replaced it:
// the KPI strip, the advisory modal, and the tabbed secondary panel.

const SITE_CLEAR = {
  id: 'site-1',
  city: 'Taguig',
  province: 'NCR',
  latitude: 14.55,
  longitude: 121.05,
  latestSeverity: 'none',
  observedAt: '2026-09-20T02:00:00.000Z',
};
const SITE_ALERT = {
  id: 'site-2',
  city: 'Cebu',
  province: 'Cebu',
  latitude: 10.3,
  longitude: 123.9,
  latestSeverity: 'warning',
  observedAt: '2026-09-20T02:00:00.000Z',
};

// reportQueries.snapshot() fans out to two endpoints and combines them.
const UTILIZATION = {
  fleet: [{ equipmentId: 'eq-1', runtimeHours: 412.5, utilizationPct: 68.4 }],
};
const FINANCIAL = { invoiced: { total: 1250000 }, depositDeducted: 84000 };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const json = (v: unknown) =>
        Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/reports/utilization')) return json(UTILIZATION);
      if (u.includes('/reports/financial')) return json(FINANCIAL);
      if (u.includes('/weather/advisories')) return json({ items: [], total: 0 });
      if (u.includes('/sites')) return json({ items: [SITE_CLEAR, SITE_ALERT], total: 2 });
      if (u.includes('/incidents')) return json({ items: [], total: 0 });
      if (u.includes('/invoices')) return json({ items: [], total: 0 });
      if (u.includes('/equipment')) return json({ items: [], total: 0 });
      if (u.includes('/edtr')) return json({ items: [], total: 0 });
      return json({ items: [], total: 0 });
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Admin dashboard', () => {
  it('leads with the four headline figures rather than a rail of every number', async () => {
    await renderRoute('/app');

    // Deposit deducted is the money-path figure and the one that used to sit
    // seventh in a list of counts.
    expect(await screen.findByText('Deposit deducted')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('412.5 h')).toBeInTheDocument());
    expect(screen.getByText('Invoiced')).toBeInTheDocument();
    expect(screen.getByText('Utilization')).toBeInTheDocument();
  });

  it('collapses the advisory banners into one line that opens them on demand', async () => {
    await renderRoute('/app');

    // One site is under advisory, one is clear: the summary counts the
    // advisory, and the full banner is not on the page until asked for.
    const trigger = await screen.findByRole('button', { name: /1 site is under a weather advisory/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Cebu');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows one secondary queue at a time, switchable by click and by arrow key', async () => {
    await renderRoute('/app');

    const payments = await screen.findByRole('tab', { name: 'Payments' });
    expect(payments).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Nothing awaiting payment.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Weather' }));
    expect(screen.getByRole('tab', { name: 'Weather' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Nothing awaiting payment.')).not.toBeInTheDocument();
    expect(screen.getByText('Taguig')).toBeInTheDocument();

    // Arrow keys wrap, so the tablist is usable without a mouse.
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-selected', 'true');
  });
});
