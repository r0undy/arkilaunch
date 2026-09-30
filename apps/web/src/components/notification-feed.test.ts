import { describe, expect, it } from 'vitest';
import { describeNotification, feedAreaOf, notificationIcon, type FeedArea } from './notification-feed.js';
import { routeTree } from '../router.js';

// Every notification type the backend writes, by recipient; each must resolve to a real destination.
// Adding a writer means adding it here.
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
    ['equipment_weather_briefing', { project_site_id: '44444444-4444-4444-8444-444444444444', site_name: 'Lot 5, Pasig', level: 'stop_work', machines: [{ equipmentId: 'e1', rentalId: RENTAL.rental_id, equipmentName: 'Crane', equipmentType: 'Crane', level: 'stop_work', reasons: ['Gusts 70 km/h'], hours: ['13:00', '14:00'] }] }],
    ['equipment_weather_outlook', { project_site_id: '44444444-4444-4444-8444-444444444444', site_name: 'Lot 5, Pasig', level: 'stop_work', machines: [{ equipmentId: 'e1', rentalId: RENTAL.rental_id, equipmentName: 'Crane', equipmentType: 'Crane', level: 'stop_work', reasons: ['Gusts 70 km/h'], hours: ['13:00', '14:00'] }] }],
    ['company_submitted', { company_name: 'Acme', customer_id: 'c1' }],
    ['company_reapplied', { company_name: 'Acme', customer_id: 'c1' }],
    ['password_reset_requested', { email: 'a@b.c' }],
    ['booking_cancelled', RENTAL],
    ['truck_price_accepted', { ...TRUCK, price_php: 5000 }],
    ['truck_cancelled', TRUCK],
    ['payment_on_void_invoice', { invoice_id: '33333333-3333-4333-8333-333333333333', booking_code: 'EQR-2026-0001' }],
    ['hold_expired', { ...RENTAL, audience: 'staff' }],
  ],
  admin: [
    ['tenant_registered', { application_id: '55555555-5555-4555-8555-555555555555', company_name: 'New Rentals Inc.' }],
  ],
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
    ['equipment_weather_briefing', { project_site_id: '44444444-4444-4444-8444-444444444444', site_name: 'Lot 5, Pasig', level: 'stop_work', machines: [{ equipmentId: 'e1', rentalId: RENTAL.rental_id, equipmentName: 'Crane', equipmentType: 'Crane', level: 'stop_work', reasons: ['Gusts 70 km/h'], hours: ['13:00', '14:00'] }] }],
    ['company_verified', { company_name: 'Acme', customer_id: 'c1' }],
    ['hold_expired', { ...RENTAL, audience: 'customer' }],
    ['company_rejected', { company_name: 'Acme', customer_id: 'c1' }],
    ['company_review_comment', { company_name: 'Acme', company_id: 'c1', comment: 'Re-upload' }],
  ],
  field: [
    ['equipment_weather_alert', { ...RENTAL, level: 'stop_work', equipment_name: 'Crane' }],
    ['equipment_weather_briefing', { project_site_id: '44444444-4444-4444-8444-444444444444', site_name: 'Lot 5, Pasig', level: 'stop_work', machines: [{ equipmentId: 'e1', rentalId: RENTAL.rental_id, equipmentName: 'Crane', equipmentType: 'Crane', level: 'stop_work', reasons: ['Gusts 70 km/h'], hours: ['13:00', '14:00'] }] }],
    ['edtr_approved', { ...RENTAL, report_date: '2026-09-21' }],
    ['edtr_needs_correction', { ...RENTAL, report_date: '2026-09-21', reason: 'Meter missing' }],
    ['edtr_rejected', { ...RENTAL, report_date: '2026-09-21', reason: 'Wrong unit' }],
    ['edtr_review', { count: 1 }],
    ['weather_advisory', { severity: 'orange' }],
  ],
};

function registeredPaths(route: { fullPath?: string; children?: unknown }): string[] {
  const children = (route.children ?? []) as { fullPath?: string; children?: unknown }[];
  return [...(typeof route.fullPath === 'string' ? [route.fullPath] : []), ...children.flatMap(registeredPaths)];
}
const ROUTES = new Set(registeredPaths(routeTree as never));

describe('describeNotification: every written type has a destination', () => {
  for (const [area, cases] of Object.entries(WRITTEN) as [FeedArea, [string, Record<string, unknown>][]][]) {
    for (const [type, payload] of cases) {
      it(`${area}: ${type}${payload.truck_request_id ? ' (truck)' : ''}`, () => {
        const described = describeNotification(type, payload, area);
        const action = described?.action;
        expect(action?.to, `${type} in ${area}`).toBeTruthy();
        // Each console links into itself only.
        expect(action!.to.startsWith(`/${area}`)).toBe(true);
        // ...to a route that exists, with every path param filled.
        expect(ROUTES).toContain(action!.to);
        for (const param of action!.to.match(/\$(\w+)/g) ?? []) {
          expect(action!.params[param.slice(1)], `${type}: ${param}`).toBeTruthy();
        }
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

  it('tells the timekeeper which machine, when, and to brief the crew', () => {
    const d = describeNotification(
      'equipment_weather_briefing',
      { site_name: 'Lot 5, Pasig', level: 'stop_work', machines: [{ equipmentId: 'e1', rentalId: 'r1', equipmentName: 'Crane', equipmentType: 'Crane', level: 'stop_work', reasons: [], hours: ['13:00', '14:00'] }] },
      'field',
    );
    expect(d?.title).toContain('Lot 5, Pasig');
    expect(d?.body).toContain('Crane - Stop work (13:00-14:00)');
    expect(d?.body).toContain('Brief the operators');
  });

  it('names the booking by code, never by UUID fragment', () => {
    expect(describeNotification('payment_received', RENTAL, 'account')?.body).toContain('EQR-2026-0001');
  });

  it('reads the console from the role, the path only when signed out', () => {
    expect(feedAreaOf('/account/notifications', null)).toBe('account');
    expect(feedAreaOf('/field/notifications', null)).toBe('field');
    expect(feedAreaOf('/app/notifications', null)).toBe('app');
    expect(feedAreaOf('/admin/notifications', null)).toBe('admin');
    // A customer's bell on the storefront (/equipment) links to their own screens.
    expect(feedAreaOf('/equipment', 'customer')).toBe('account');
    expect(feedAreaOf('/equipment', 'owner')).toBe('app');
    expect(feedAreaOf('/', 'platform_admin')).toBe('admin');
    expect(feedAreaOf('/', 'timekeeper')).toBe('field');
  });

  it('opens payments, change requests and messages on the booking tab they are about', () => {
    expect(describeNotification('payment_paid', RENTAL, 'app')?.action).toMatchObject({ to: '/app/bookings', search: { open: 'EQR-2026-0001', tab: 'actions' } });
    expect(describeNotification('change_request_submitted', RENTAL, 'app')?.action?.search).toMatchObject({ tab: 'actions' });
    expect(describeNotification('customer_message', RENTAL, 'app')?.action?.search).toMatchObject({ tab: 'negotiation' });
    expect(describeNotification('company_submitted', { customer_id: 'c1' }, 'app')?.action?.search).toEqual({ open: 'c1' });
    expect(describeNotification('maintenance_due', { serial_no: 'SN-9' }, 'app')?.action?.search).toEqual({ q: 'SN-9' });
  });
});

describe('notificationIcon', () => {
  it('names the kind of event and how it went', () => {
    expect(notificationIcon('payment_received').tone).toBe('success');
    expect(notificationIcon('payment_failed').tone).toBe('danger');
    expect(notificationIcon('payment_amount_mismatch').tone).toBe('danger');
    expect(notificationIcon('weekly_invoice').Icon).toBe(notificationIcon('payment_paid').Icon);
    expect(notificationIcon('equipment_weather_alert').tone).toBe('warning');
    expect(notificationIcon('company_verified').tone).toBe('success');
    expect(notificationIcon('truck_requested').Icon).not.toBe(notificationIcon('something_new').Icon);
    expect(notificationIcon('something_new').tone).toBe('neutral');
  });
});
