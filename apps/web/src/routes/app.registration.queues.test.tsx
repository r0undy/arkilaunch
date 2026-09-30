import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = (n: number) => ({
  id: id(n), companyName: `Company ${n}`, tin: null, secNumber: null, billingAddress: null, kycStatus: 'pending',
  firstName: null, middleName: null, lastName: null, rejection: null, score: null, documents: [], createdAt: '2026-09-01T00:00:00Z',
});
const page = (count: number) => ({ items: Array.from({ length: count }, (_, i) => company(i + 1)), total: count });

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      const body = u.includes('/customers/review') ? (u.includes('limit=100') ? page(25) : page(20)) : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Registration queue deep link', () => {
  it('opens a company that is past the first page', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
    stub();
    await renderRoute(`/app/registration/pending?open=${id(25)}`);

    expect(await screen.findByRole('dialog', { name: 'Company 25' })).toBeInTheDocument();
  });

  it('says so when the company is no longer waiting', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
    stub();
    await renderRoute(`/app/registration/pending?open=${id(99)}`);

    expect(await screen.findByText(/no longer waiting here/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
