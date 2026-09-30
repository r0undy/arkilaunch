import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { bookingStage, bookingTimeline, leaseProgress, rentalDuration } from './account.booking.js';
import { amountDue } from './account.checkout.js';
import { describeNotification } from '../components/notification-feed.js';

// The failure that matters: a confident "0% complete" on a hire whose dates are unknown.
describe('leaseProgress', () => {
  const start = '2026-10-01T00:00:00.000Z';
  const end = '2026-10-11T00:00:00.000Z';

  it('measures how far through the window we are', () => {
    const now = new Date('2026-10-06T00:00:00.000Z');
    expect(leaseProgress(start, end, now)).toEqual({ pct: 50, daysRemaining: 5 });
  });

  it('clamps to the window rather than reporting past 100% or negative days', () => {
    const afterwards = new Date('2026-11-01T00:00:00.000Z');
    expect(leaseProgress(start, end, afterwards)).toEqual({ pct: 100, daysRemaining: 0 });

    const beforehand = new Date('2026-09-01T00:00:00.000Z');
    expect(leaseProgress(start, end, beforehand)?.pct).toBe(0);
  });

  it('returns null when the window cannot be measured, instead of a made-up zero', () => {
    expect(leaseProgress(start, null)).toBeNull();
    expect(leaseProgress(start, 'not a date')).toBeNull();
    expect(leaseProgress(end, start)).toBeNull();
  });
});

function booking(overrides: Partial<BookingDetailResponse> = {}): BookingDetailResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'EQR-2026-0001',
    status: 'pending',
    projectSiteId: '22222222-2222-4222-8222-222222222222',
    siteCity: 'Pasig',
    siteProvince: null,
    trackerUrl: '/orders/x',
    customerId: '33333333-3333-4333-8333-333333333333',
    siteContact: null,
    siteNotes: null,
    callRequestedAt: null,
    callConfirmedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    items: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        equipmentId: '44444444-4444-4444-8444-444444444444',
        start: new Date('2026-10-01T08:00:00Z'),
        end: new Date('2026-10-05T17:00:00Z'),
        status: 'scheduled',
      },
    ],
    quotation: null,
    deposit: { required: null, totalDeducted: 0, deductions: [] },
    changeRequests: [],
    invoices: [],
    payments: [],
    ...overrides,
  };
}

const accepted = {
  id: '55555555-5555-4555-8555-555555555555',
  revision: 2,
  status: 'accepted',
  totalPhp: 30000,
  createdAt: new Date('2026-09-02T00:00:00Z'),
};

// Must match the server's rule, above all never showing the deposit twice.
describe('amountDue', () => {
  it('is the accepted quote plus the contract deposit', () => {
    const due = amountDue(
      booking({
        quotation: accepted,
        deposit: { required: 5000, totalDeducted: 0, deductions: [] },
      }),
    );
    expect(due).toEqual({ rent: 30000, deposit: 5000, total: 35000 });
  });

  it('leaves out a deposit already paid on the reservation', () => {
    const due = amountDue(
      booking({
        quotation: accepted,
        deposit: { required: 5000, totalDeducted: 0, deductions: [] },
        invoices: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            invoiceType: 'deposit',
            amount: 5000,
            status: 'paid',
          },
        ],
      }),
    );
    expect(due.total).toBe(30000);
  });

  it('shows an issued booking invoice as it stands, coupon discount included', () => {
    const due = amountDue(
      booking({
        quotation: accepted,
        deposit: { required: 5000, totalDeducted: 0, deductions: [] },
        invoices: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            invoiceType: 'booking',
            amount: 32000,
            status: 'issued',
          },
        ],
      }),
    );
    expect(due.total).toBe(32000);
  });

  it('does not invent a total before anything is priced', () => {
    expect(amountDue(booking()).total).toBeNull();
  });
});

describe('bookingTimeline', () => {
  const done = (b: BookingDetailResponse) =>
    bookingTimeline(b)
      .filter((s) => s.done)
      .map((s) => s.label);

  it('only marks a step done when the record behind it exists', () => {
    expect(done(booking())).toEqual(['Requested']);
    expect(done(booking({ quotation: accepted }))).toEqual(['Requested', 'Price agreed']);
  });

  it('marks delivery and return only when staff record them, not by the calendar', () => {
    const paid = booking({ quotation: accepted, status: 'confirmed' });
    expect(done(paid)).toEqual(['Requested', 'Price agreed', 'Paid']);
    expect(done({ ...paid, status: 'active' })).toEqual([
      'Requested',
      'Price agreed',
      'Paid',
      'Delivered',
    ]);
    expect(done({ ...paid, status: 'completed' })).toEqual([
      'Requested',
      'Price agreed',
      'Paid',
      'Delivered',
      'Returned',
    ]);
  });
});

describe('describeNotification', () => {
  it('turns a journey event into a sentence with a destination', () => {
    const described = describeNotification('quote_ready', {
      rental_id: booking().id,
      total_php: 30000,
    }, 'account');
    expect(described?.title).toBe('Quote ready');
    expect(described?.action?.to).toBe('/account/negotiation/$bookingId');
  });

  it('describes delivery, return and staff cancellation instead of dumping the payload', () => {
    for (const type of ['equipment_delivered', 'equipment_returned', 'booking_cancelled']) {
      expect(describeNotification(type, { rental_id: booking().id }, 'account')?.action?.to).toBe(
        '/account/bookings/$bookingId',
      );
    }
  });

  it('falls back for anything it does not know', () => {
    expect(describeNotification('maintenance_due', { equipment_id: 'x' }, 'account')).toBeNull();
  });
});

describe('bookingStage', () => {
  it('shows money and deposit only once paid, hire progress only once on site', () => {
    expect(bookingStage(booking())).toEqual({ paid: false, onSite: false, cancelled: false });
    expect(bookingStage(booking({ status: 'confirmed' }))).toEqual({ paid: true, onSite: false, cancelled: false });
    expect(bookingStage(booking({ status: 'active' }))).toEqual({ paid: true, onSite: true, cancelled: false });
  });
});

describe('customer booking page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('names the machine without asking for the staff-only fleet list', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    const b = booking();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes(`/bookings/${b.id}`) ? { ...b, items: [{ ...b.items[0], equipmentName: 'CAT 320D' }] } : []),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await renderRoute(`/account/bookings/${b.id}`);

    expect(await screen.findByText('CAT 320D')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/equipment?'))).toBe(false);
  });
});


describe('rentalDuration', () => {
  it('uses the same rounded-up rental days as booking pricing', () => {
    expect(rentalDuration('2026-10-01T08:00:00Z', '2026-10-05T17:00:00Z')).toBe(5);
    expect(rentalDuration('2026-10-01T08:00:00Z', '2026-10-01T17:00:00Z')).toBe(1);
  });
  it('does not invent days for unknown or invalid dates', () => {
    expect(rentalDuration('2026-10-01', null)).toBeNull();
    expect(rentalDuration('bad', '2026-10-02')).toBeNull();
    expect(rentalDuration('2026-10-02', '2026-10-01')).toBeNull();
  });
});

describe('customer cost breakdown', () => {
  afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });
  it('shows saved line costs, hours and adjustments alongside each machine rental duration', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    const b = booking({ quotation: accepted });
    const quote = {
      ...accepted, lineItems: [
        { kind: 'equipment', equipmentTypeId: 'excavator', equipmentTypeName: 'Excavator', quantity: 1, estimatedHours: 40, rentParts: [], rent: 24000, hourlyRate: 600, operatingCost: 24000, buffer: 0, subtotal: 24000 },
        { kind: 'equipment', equipmentTypeId: 'loader', equipmentTypeName: 'Loader', quantity: 2, estimatedHours: 8, rentParts: [], rent: 3000, hourlyRate: 375, operatingCost: 6000, buffer: 0, subtotal: 6000 },
      ], mobilization: 2000, demobilization: 1000, subtotal: 33000, discount: 3000, total: 30000,
    };
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
      String(url).includes('/quotes/') ? quote : String(url).includes('/bookings/') ? b : []
    ), { status: 200 }))));
    await renderRoute('/account/bookings/' + b.id);
    expect(await screen.findByRole('heading', { name: 'Equipment cost breakdown' })).toBeVisible();
    const lines = await screen.findByRole('list', { name: 'Quote line items' });
    expect(within(lines).getByText('40 quoted billable hours per unit')).toBeVisible();
    expect(within(lines).getByText('8 quoted billable hours per unit')).toBeVisible();
    expect(within(lines).getByText(/per unit before booking-level/)).toHaveTextContent('3,000');
    expect(screen.getByText('Mobilization')).toBeVisible();
    expect(screen.getByText('Demobilization')).toBeVisible();
    expect(screen.getByText('Discount')).toBeVisible();
    expect(screen.getByText('Quoted rental total').parentElement).toHaveTextContent('30,000');
    expect(within(lines).getAllByText('Quoted line total')[0]).toBeDefined();
    expect(screen.getByText('5 rental days')).toBeVisible();
  });
  it.each([null, { ...accepted, totalPhp: null }])('shows a preparing message when the quote has no price: %j', async (quotation) => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    const b = booking({ quotation });
    const fetchMock = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(String(url).includes('/bookings/') ? b : []), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await renderRoute('/account/bookings/' + b.id);
    expect(await screen.findByText(/Your equipment costs will appear here/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/quotes/'))).toBe(false);
  });
});
