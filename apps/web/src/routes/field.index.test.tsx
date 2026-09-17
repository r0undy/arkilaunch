import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// The defect this covers: /app/ocr is guarded to admin/owner/platform_admin,
// so a timekeeper was redirected to /field, which had no way to open the
// capture modal at all. Recording a field log is that role's entire job
// (PRD US-02, S21), and POST /edtr has always granted it `edtr:create`.

const SITE = { id: 'site-1', name: 'Bonifacio Tower', code: 'BGC-1' };
const RENTAL = { id: 'rental-1', customerId: 'cust-1', projectSiteId: 'site-1' };
const EQUIPMENT = { id: 'eq-1', model: 'CAT 320D', serialNo: 'SN-1' };
const CUSTOMER = { id: 'cust-1', companyName: 'Almara Construction' };

function stubFetch({ rentals = [RENTAL], sites = [SITE] }: { rentals?: unknown[]; sites?: unknown[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/reference/rentals')) return json(rentals);
      if (u.includes('/reference/equipment')) return json([EQUIPMENT]);
      if (u.includes('/reference/customers')) return json([CUSTOMER]);
      if (u.includes('/reference/project-sites')) return json(sites);
      if (u.includes('/sites')) return json({ items: sites, total: sites.length });
      if (u.includes('/edtr')) return json({ items: [], total: 0 });
      return json([]);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  setAccessToken(makeToken(makeValidClaims({ role: 'timekeeper' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Field dashboard: EDTR capture entry point', () => {
  it('lets a timekeeper open the capture modal without visiting the staff console', async () => {
    stubFetch();
    await renderRoute('/field');

    const record = await screen.findByRole('button', { name: 'Record a field log' });
    await waitFor(() => expect(record).toBeEnabled());
    await userEvent.click(record);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('offers the camera and the file picker as separate actions once a paper sheet is chosen', async () => {
    stubFetch();
    await renderRoute('/field');

    const record = await screen.findByRole('button', { name: 'Record a field log' });
    await waitFor(() => expect(record).toBeEnabled());
    await userEvent.click(record);

    await userEvent.click(await screen.findByRole('radio', { name: /photo of the paper sheet/i }));

    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });

  it('does not offer capture when nothing is out on rental, rather than opening an unusable form', async () => {
    stubFetch({ rentals: [] });
    await renderRoute('/field');

    const record = await screen.findByRole('button', { name: 'Record a field log' });
    expect(record).toBeDisabled();
    expect(screen.getByText(/no hours to record/i)).toBeInTheDocument();
  });
});
