import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// The counters and the three status tabs are computed in the browser over an
// unpaginated GET /me/companies. A miscount here is a customer being told a
// company is approved when it is not, so the arithmetic and the filter get a
// test even though the page itself is a list.

const COMPANIES = [
  { id: 'c1', companyName: '123 Company', tin: null, secNumber: 'PH62780901', billingAddress: null, kycStatus: 'pending', firstName: null, middleName: null, lastName: null, documents: [], createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'c2', companyName: 'Acorn Company', tin: null, secNumber: 'PH81923101', billingAddress: null, kycStatus: 'pending', firstName: null, middleName: null, lastName: null, documents: [], createdAt: '2026-09-02T00:00:00.000Z' },
  { id: 'c4', companyName: 'Response Basics Incorporated', tin: '444-075-342-000', secNumber: null, billingAddress: null, kycStatus: 'pending', firstName: null, middleName: null, lastName: null, rejection: null, documents: [
    { id: 'd1', documentType: 'government_id', status: 'needs_review', createdAt: '2026-09-04T00:00:00.000Z' },
    { id: 'd2', documentType: 'selfie_with_id', status: 'needs_review', createdAt: '2026-09-04T00:00:00.000Z' },
    { id: 'd3', documentType: 'bir_cor', status: 'needs_review', createdAt: '2026-09-04T00:00:00.000Z' },
  ], createdAt: '2026-09-04T00:00:00.000Z' },
  { id: 'c3', companyName: 'Manila Constructions', tin: null, secNumber: 'PH01982234', billingAddress: null, kycStatus: 'approved', firstName: null, middleName: null, lastName: null, documents: [], createdAt: '2026-09-03T00:00:00.000Z' },
];

async function renderApplications() {
  setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/me/companies')
          ? new Response(JSON.stringify(COMPANIES), { status: 200 })
          : new Response('[]', { status: 200 }),
      ),
    ),
  );
  const rendered = await renderRoute('/account/applications');
  await waitFor(() => expect(screen.getByRole('group', { name: '123 Company' })).toBeInTheDocument());
  return rendered;
}

const cards = () => screen.queryAllByRole('group').map((el) => el.getAttribute('aria-label'));

describe('Company Applications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('counts the companies by verification state', async () => {
    const { unmount } = await renderApplications();
    const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).closest('div')!;
    expect(within(tile('Total applications')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Approved')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Pending approval')).getByText('3')).toBeInTheDocument();
    unmount();
  });

  it('narrows to one status at a time', async () => {
    const { unmount } = await renderApplications();
    expect(cards()).toHaveLength(4);

    await userEvent.click(screen.getByRole('button', { name: 'Pending approval' }));
    expect(cards()).toEqual(['123 Company', 'Acorn Company', 'Response Basics Incorporated']);

    await userEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(cards()).toEqual(['Manila Constructions']);

    await userEvent.click(screen.getByRole('button', { name: 'All applications' }));
    expect(cards()).toHaveLength(4);
    unmount();
  });

  it('searches the registration number as well as the name', async () => {
    const { unmount } = await renderApplications();
    const box = screen.getByRole('searchbox', { name: /search companies/i });

    await userEvent.type(box, 'acorn');
    expect(cards()).toEqual(['Acorn Company']);

    await userEvent.clear(box);
    await userEvent.type(box, 'PH01982234');
    expect(cards()).toEqual(['Manila Constructions']);
    unmount();
  });

  // A company registered off its BIR Form 2303 has a TIN and no SEC number;
  // the card said "Registration number Not provided" for it.
  it('shows the number and documents actually submitted, and where it stands', async () => {
    const { unmount } = await renderApplications();
    const card = screen.getByRole('group', { name: 'Response Basics Incorporated' });
    expect(within(card).getByText('444-075-342-000')).toBeInTheDocument();
    expect(within(card).getByText(/Submitted: .*Form 2303/)).toBeInTheDocument();
    expect(within(card).getByText(/Under review/)).toBeInTheDocument();
    expect(within(card).queryByText(/Not provided/)).toBeNull();
    const incomplete = screen.getByRole('group', { name: '123 Company' });
    expect(within(incomplete).getByText(/Still needed/)).toBeInTheDocument();
    unmount();
  });

  // A filter that hides everything must say so rather than leaving a blank
  // page that reads as "you have no companies".
  it('distinguishes "nothing matches" from "nothing registered"', async () => {
    const { unmount } = await renderApplications();
    await userEvent.type(screen.getByRole('searchbox', { name: /search companies/i }), 'zzz');
    expect(cards()).toHaveLength(0);
    expect(screen.getByText(/No companies match/i)).toBeInTheDocument();
    unmount();
  });
});
