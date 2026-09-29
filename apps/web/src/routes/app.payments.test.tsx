import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

const INVOICE = {
  id: '77777777-7777-4777-8777-777777777777', rentalId: null, truckRequestId: null, bookingCode: 'EQR-1',
  invoiceType: 'booking', amount: 5000, status: 'issued', dueDate: '2026-10-01', createdAt: '2026-09-01',
};

function stub(cashStatus: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/cash-payment')) return Promise.resolve(new Response('{"error":"invoice_not_payable"}', { status: cashStatus }));
      const body = u.includes('/invoices') ? { items: [INVOICE], total: 1 } : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

async function recordCash() {
  setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
  await renderRoute('/app/payments');
  await userEvent.click(await screen.findByRole('button', { name: /invoice INV-/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Record cash payment' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Record cash payment' });
  await userEvent.click(within(confirm).getByRole('button', { name: 'Record payment' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Invoice drawer', () => {
  it('closes once cash is recorded, so the stale invoice is not offered again', async () => {
    stub(200);
    await recordCash();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Record cash payment' })).not.toBeInTheDocument());
  });

  it('keeps the drawer open and reports a refused payment without an unhandled rejection', async () => {
    stub(409);
    await recordCash();
    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record cash payment' })).toBeInTheDocument();
  });
});
