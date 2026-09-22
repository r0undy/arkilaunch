import { describe, expect, it } from 'vitest';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { bookingTimeline, leaseProgress } from './account.booking.js';
import { amountDue } from './account.checkout.js';
import { describeNotification } from '../components/notification-feed.js';

// The progress bar is the one piece of arithmetic on the booking screen, and
// the failure that matters is not an off-by-one percentage -- it is showing
// a confident "0% complete, 0 days remaining" on a hire whose dates are not
// actually known, which reads as "your rental is over".
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
    status: 'pending',
    projectSiteId: '22222222-2222-4222-8222-222222222222',
    siteCity: 'Pasig',
    siteProvince: null,
    trackerUrl: '/orders/x',
    customerId: '33333333-3333-4333-8333-333333333333',
    siteContact: null,
    siteNotes: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    items: [
      {
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

// What the checkout screen tells the customer they will pay. It must match
// the server's rule, above all never showing the deposit twice.
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
    });
    expect(described?.title).toBe('Quote ready');
    expect(described?.action?.to).toBe('/account/negotiation/$bookingId');
  });

  it('describes delivery, return and staff cancellation instead of dumping the payload', () => {
    for (const type of ['equipment_delivered', 'equipment_returned', 'booking_cancelled']) {
      expect(describeNotification(type, { rental_id: booking().id })?.action?.to).toBe(
        '/account/bookings/$bookingId',
      );
    }
  });

  it('falls back for anything it does not know', () => {
    expect(describeNotification('maintenance_due', { equipment_id: 'x' })).toBeNull();
  });
});
