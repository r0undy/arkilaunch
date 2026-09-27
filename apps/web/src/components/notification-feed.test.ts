import { describe, expect, it } from 'vitest';
import { describeNotification, feedAreaOf, type FeedArea } from './notification-feed.js';

// Every notification type the backend writes, by who receives it. Each must
// resolve to a real destination in that person's console, so a row is
// never a dead end (admin feedback item 4). Adding a writer means adding it
// here, or this list drifts from the code.
const RENTAL = { rental_id: '11111111-1111-4111-8111-111111111111', booking_code: 'EQR-2026-0001' };
const TRUCK = { truck_request_id: '22222222-2222-4222-8222-222222222222', booking_code: 'TRK-2026-0001' };

const WRITTEN: Record<FeedArea, [string, Record<string, unknown>][]> = {
  app: [
    ['booking_requested', RENTAL],
    ['truck_requested', TRUCK],
    ['call_requested', RENTAL],
    ['call_requested', TRUCK],
    ['customer_message', RENTAL],
    ['customer_message', TRUCK],
    ['quote_accepted', RENTAL],
    ['quote_declined', RENTAL],
    ['change_request_submitted', { ...RENTAL, kind: 'extend' }],
    ['deposit_low', { ...RENTAL, balance_php: 100, deposit_php: 1000 }],
    ['payment_paid', RENTAL],
    ['payment_failed', { invoice_id: '33333333-3333-4333-8333-333333333333' }],
    ['payment_amount_mismatch', { invoice_id: '33333333-3333-4333-8333-333333333333' }],
    ['edtr_submitted', { ...RENTAL, project_site_id: '44444444-4444-4444-8444-444444444444', report_date: '2026-09-21' }],
    ['maintenance_due', { equipment_id: 'e1', runtime_hours: 500 }],
    ['maintenance_warning', { equipment_id: 'e1' }],
    ['weather_advisory', { severity: 'orange' }],
    ['equipment_weather_alert', { ...RENTAL, level: 'caution' }],
    ['company_submitted', { company_name: 'Acme' }],
    ['company_reapplied', { company_name: 'Acme' }],
    ['password_reset_requested', { email: 'a@b.c' }],
  ],
  admin: [['password_reset_requested', { email: 'a@b.c' }]],
  account: [
    ['quote_ready', { ...RENTAL, total_php: 1000 }],
    ['negotiation_reply', RENTAL],
    ['negotiation_reply', TRUCK],
    ['payment_received', RENTAL],
    ['payment_failed', RENTAL],
    ['payment_refunded', RENTAL],
    ['call_confirmed', RENTAL],
    ['call_confirmed', TRUCK],
    ['equipment_delivered', RENTAL],
    ['equipment_returned', RENTAL],
    ['booking_cancelled', RENTAL],
    ['deposit_low', { ...RENTAL, balance_php: 100, deposit_php: 1000 }],
    ['weekly_invoice', { ...RENTAL, invoice_id: '33333333-3333-4333-8333-333333333333', amount_php: 500 }],
    ['change_request_resolved', { ...RENTAL, kind: 'extend', decision: 'approved' }],
    ['daily_log_approved', { ...RENTAL, report_date: '2026-09-21' }],
    ['equipment_weather_warning', { ...RENTAL, level: 'caution' }],
    ['company_verified', { company_name: 'Acme' }],
    ['company_rejected', { company_name: 'Acme', customer_id: 'c1' }],
    ['company_review_comment', { company_name: 'Acme', company_id: 'c1', comment: 'Re-upload' }],
  ],
  field: [
    ['edtr_approved', { ...RENTAL, report_date: '2026-09-21' }],
    ['edtr_needs_correction', { ...RENTAL, report_date: '2026-09-21', reason: 'Meter missing' }],
    ['edtr_rejected', { ...RENTAL, report_date: '2026-09-21', reason: 'Wrong unit' }],
    ['edtr_review', { count: 1 }],
    ['weather_advisory', { severity: 'orange' }],
  ],
};

describe('describeNotification: every written type has a destination', () => {
  for (const [area, cases] of Object.entries(WRITTEN) as [FeedArea, [string, Record<string, unknown>][]][]) {
    for (const [type, payload] of cases) {
      it(`${area}: ${type}${payload.truck_request_id ? ' (truck)' : ''}`, () => {
        const described = describeNotification(type, payload, area);
        expect(described?.action?.to, `${type} in ${area}`).toBeTruthy();
        // A staff link stays in the staff console, a customer's in theirs.
        const prefix = area === 'admin' ? '/app' : `/${area}`;
        expect(described!.action!.to.startsWith(prefix)).toBe(true);
      });
    }
  }

  it('opens a staff booking in the drawer by its code', () => {
    expect(describeNotification('booking_requested', RENTAL, 'app')?.action).toMatchObject({
      to: '/app/bookings',
      search: { open: 'EQR-2026-0001' },
    });
  });

  it('sends a submitted field log to its site hub', () => {
    expect(
      describeNotification('edtr_submitted', { ...RENTAL, project_site_id: 's1' }, 'app')?.action,
    ).toMatchObject({ to: '/app/deployment/$siteId', params: { siteId: 's1' }, search: { tab: 'logs' } });
  });

  it('names the booking by code, never by UUID fragment', () => {
    expect(describeNotification('payment_received', RENTAL, 'account')?.body).toContain('EQR-2026-0001');
  });

  it('reads the console from the path', () => {
    expect(feedAreaOf('/account/notifications')).toBe('account');
    expect(feedAreaOf('/field/notifications')).toBe('field');
    expect(feedAreaOf('/app/notifications')).toBe('app');
    expect(feedAreaOf('/admin/notifications')).toBe('admin');
  });
});
