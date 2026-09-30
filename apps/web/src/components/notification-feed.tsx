import { useState } from 'react';
import { notificationsQueries } from '../lib/queries.js';
import { Link, useRouterState } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isWeatherNotice, weatherNoticeText, type NotificationResponse, type WeatherAudience, type WeatherNoticeType } from '@arkilaunch/shared';
import { apiPatch } from '../lib/api-client.js';
import { getCurrentRole } from '../lib/guards.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { Pagination, PAGE_SIZE } from './pagination.js';
import { formatRelativeTime } from '../lib/format-time.js';
import { formatDate, formatDateTime, formatPeso, formatStatus, shortCode } from '../lib/format.js';
import { Skeleton } from './skeleton.js';
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

function payloadLines(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && typeof value !== 'object')
    .filter(([key]) => !('booking_code' in (payload as object)) || !key.endsWith('_id'))
    .map(([key, value]) => {
      const label = formatStatus(key);
      if (key.endsWith('_id') && typeof value === 'string') {
        return `${label}: ${shortCode('equipment', value)}`;
      }
      return `${label}: ${String(value)}`;
    });
}

interface Described {
  title: string;
  body: string;
  action?: { label: string; to: string; params: Record<string, string>; search?: Record<string, string> };
}

export type FeedArea = 'app' | 'account' | 'field' | 'admin';

// Role first, URL only as fallback: a customer's bell also renders on storefront pages.
export function feedAreaOf(pathname: string, role: string | null = getCurrentRole()): FeedArea {
  if (role === 'customer') return 'account';
  if (role === 'timekeeper') return 'field';
  if (role === 'platform_admin') return 'admin';
  if (role) return 'app';
  const first = pathname.split('/')[1];
  return first === 'account' || first === 'field' || first === 'admin' ? first : 'app';
}

function staffBooking(
  p: Record<string, unknown>,
  label = 'Open booking',
  tab?: 'actions' | 'negotiation',
): NonNullable<Described['action']> {
  const code = typeof p.booking_code === 'string' ? p.booking_code : null;
  if (code) return { label, to: '/app/bookings', params: {}, search: { open: code, ...(tab ? { tab } : {}) } };
  const rentalId = typeof p.rental_id === 'string' ? p.rental_id : null;
  return rentalId
    ? { label, to: '/app/bookings/$bookingId', params: { bookingId: rentalId } }
    : { label, to: '/app/bookings', params: {} };
}

function staffPayment(p: Record<string, unknown>): NonNullable<Described['action']> {
  return typeof p.booking_code === 'string' || typeof p.rental_id === 'string'
    ? staffBooking(p, 'Open booking', 'actions')
    : { label: 'Open payments', to: '/app/payments', params: {} };
}

function describeForPlatform(type: string, p: Record<string, unknown>): Described | null {
  if (type !== 'tenant_registered') return null;
  const name = typeof p.company_name === 'string' ? p.company_name : 'A rental company';
  return {
    title: 'New rental company',
    body: `${name} registered on the platform.`,
    action:
      typeof p.application_id === 'string'
        ? { label: 'Open application', to: '/admin/applications/$applicationId', params: { applicationId: p.application_id } }
        : { label: 'Open applications', to: '/admin/applications', params: {} },
  };
}

function describeForStaff(type: string, p: Record<string, unknown>): Described | null {
  const ref = typeof p.booking_code === 'string' ? p.booking_code : 'a booking';
  const trip = typeof p.truck_request_id === 'string';
  switch (type) {
    case 'booking_requested':
      return { title: 'New booking', body: `${ref} was requested.`, action: staffBooking(p) };
    case 'truck_requested':
      return { title: 'New truck request', body: `${ref}: a customer requested a self-loading truck.`, action: staffBooking(p) };
    case 'call_requested':
      return {
        title: 'Call requested',
        body: `The customer on ${ref} asked for a call${trip ? '' : ' before paying'}.`,
        action: staffBooking(p, 'Call the customer', 'actions'),
      };
    case 'truck_price_accepted':
      return {
        title: 'Price accepted',
        body: `The customer accepted ${typeof p.price_php === 'number' ? formatPeso(p.price_php) : 'the agreed price'} on ${ref}.`,
        action: staffBooking(p, 'Open booking', 'actions'),
      };
    case 'booking_cancelled':
      return { title: 'Booking cancelled', body: `The customer cancelled ${ref}. Its unpaid invoice was voided.`, action: staffBooking(p) };
    case 'truck_cancelled':
      return { title: 'Trip cancelled', body: `The customer cancelled ${ref}. Its unpaid invoice was voided.`, action: staffBooking(p) };
    case 'payment_on_void_invoice':
      return {
        title: 'Refund needed',
        body: `A payment came in on ${ref} after its invoice was voided (price changed or cancelled). Refund it in PayMongo.`,
        action: staffPayment(p),
      };
    case 'customer_message': {
      const offer = typeof p.offer_php === 'number' ? ` with an offer of ${formatPeso(p.offer_php)}` : '';
      return {
        title: 'Customer message',
        body: `The customer replied on ${ref}${offer}.`,
        action: staffBooking(p, 'Open conversation', 'negotiation'),
      };
    }
    case 'quote_accepted':
    case 'quote_declined':
      return {
        title: type === 'quote_accepted' ? 'Quote accepted' : 'Quote declined',
        body: `The customer ${type === 'quote_accepted' ? 'accepted' : 'declined'} the quote on ${ref}.`,
        action: staffBooking(p),
      };
    case 'change_request_submitted':
      return {
        title: 'Change request',
        body: `The customer asked to ${p.kind === 'cancel' ? 'cancel' : 'extend'} ${ref}.`,
        action: staffBooking(p, 'Review request', 'actions'),
      };
    case 'deposit_low':
      return {
        title: 'Deposit running low',
        body: `${ref} has ${formatPeso(p.balance_php as number)} left of its ${formatPeso(p.deposit_php as number)} deposit.`,
        action: staffBooking(p),
      };
    case 'payment_paid':
    case 'payment_received':
    case 'payment_failed':
    case 'payment_refunded':
    case 'payment_disputed':
    case 'payment_amount_mismatch': {
      const what: Record<string, string> = {
        payment_paid: 'was paid',
        payment_received: 'was paid',
        payment_failed: 'failed',
        payment_refunded: 'was refunded',
        payment_disputed: 'is disputed',
        payment_amount_mismatch: 'came in at a different amount than the invoice',
      };
      return {
        title: type === 'payment_amount_mismatch' ? 'Payment amount mismatch' : `Payment ${type.slice('payment_'.length)}`,
        body: `An online payment on ${ref} ${what[type]}.`,
        action: staffPayment(p),
      };
    }
    case 'edtr_submitted':
      return {
        title: 'Field log submitted',
        body: `A timekeeper submitted ${typeof p.report_date === 'string' ? p.report_date : 'a day'} on ${ref}. It is waiting for approval.`,
        action:
          typeof p.project_site_id === 'string'
            ? { label: 'Review in site hub', to: '/app/deployment/$siteId', params: { siteId: p.project_site_id }, search: { tab: 'logs' } }
            : { label: 'Open field logs', to: '/app/ocr', params: {} },
      };
    case 'maintenance_due':
    case 'maintenance_warning':
      return {
        title: type === 'maintenance_due' ? 'Maintenance due' : 'Maintenance coming up',
        body: `A machine${typeof p.runtime_hours === 'number' ? ` at ${p.runtime_hours} running hours` : ''} is ${type === 'maintenance_due' ? 'due' : 'close to'} its service.`,
        action: {
          label: 'Open machine',
          to: '/app/inventory',
          params: {},
          ...(typeof p.serial_no === 'string' ? { search: { q: p.serial_no } } : {}),
        },
      };
    case 'hold_expired':
      return {
        title: 'Hold lapsed',
        body: `${ref} was not paid in time, so it was cancelled and its dates freed.`,
        action: staffBooking(p),
      };
    case 'company_submitted':
    case 'company_reapplied': {
      const name = typeof p.company_name === 'string' ? p.company_name : 'A company';
      return {
        title: type === 'company_submitted' ? 'New company registration' : 'Registration resubmitted',
        body:
          type === 'company_submitted'
            ? `${name} needs approval.`
            : `${name} uploaded new documents after a rejection and needs a fresh decision.`,
        action: {
          label: 'Review',
          to: '/app/registration/pending',
          params: {},
          ...(typeof p.customer_id === 'string' ? { search: { open: p.customer_id } } : {}),
        },
      };
    }
    case 'weather_advisory':
      return { title: 'Weather advisory', body: 'A site is under a weather advisory.', action: { label: 'Open incidents', to: '/app/incidents', params: {} } };
    default:
      return null;
  }
}

function describeForField(type: string, p: Record<string, unknown>): Described | null {
  const day = typeof p.report_date === 'string' ? p.report_date : 'a day';
  const ref = typeof p.booking_code === 'string' ? ` on ${p.booking_code}` : '';
  const toDashboard = { label: 'Open dashboard', to: '/field', params: {} };
  switch (type) {
    case 'edtr_approved':
      return { title: 'Field log approved', body: `The office approved ${day}${ref}.`, action: toDashboard };
    case 'edtr_needs_correction':
      return {
        title: 'Correction needed',
        body: `The office asked you to correct ${day}${ref}${typeof p.reason === 'string' ? `: ${p.reason}` : ''}. Submit it again.`,
        action: { label: 'Resubmit', to: '/field/scan', params: {} },
      };
    case 'edtr_rejected':
      return {
        title: 'Field log rejected',
        body: `The office rejected ${day}${ref}${typeof p.reason === 'string' ? `: ${p.reason}` : ''}.`,
        action: toDashboard,
      };
    case 'edtr_review':
      return { title: 'Field logs to check', body: 'A field log needs your attention.', action: toDashboard };
    case 'weather_advisory':
      return { title: 'Weather advisory', body: 'One of your sites is under a weather advisory.', action: { label: 'View sites', to: '/field/deployment', params: {} } };
    default:
      return null;
  }
}

function describeWeather(type: WeatherNoticeType, p: Record<string, unknown>, area: FeedArea): Described {
  const audience: WeatherAudience = area === 'field' ? 'timekeeper' : area === 'account' ? 'customer' : 'staff';
  const { title, body } = weatherNoticeText(type, p, audience);
  const machines = Array.isArray(p.machines) ? (p.machines as { rentalId?: string }[]) : [];
  const bookingId = typeof p.rental_id === 'string' ? p.rental_id : (machines[0]?.rentalId ?? '');
  const siteId = typeof p.project_site_id === 'string' ? p.project_site_id : '';
  const action: Described['action'] =
    audience === 'customer'
      ? bookingId
        ? { label: 'Open booking', to: '/account/bookings/$bookingId', params: { bookingId } }
        : { label: 'My bookings', to: '/account/bookings', params: {} }
      : audience === 'timekeeper'
        ? { label: 'Open dashboard', to: '/field', params: {} }
        : siteId
          ? { label: 'Open site', to: '/app/deployment/$siteId', params: { siteId } }
          : { label: 'Open incidents', to: '/app/incidents', params: {} };
  return { title, body, action };
}

export function describeNotification(type: string, payload: unknown, area: FeedArea = 'app'): Described | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (isWeatherNotice(type)) return describeWeather(type, p, area);
  if (area === 'field') return describeForField(type, p);
  if (area === 'admin') return describeForPlatform(type, p);
  if (area === 'app') {
    const staff = describeForStaff(type, p);
    if (staff) return staff;
  }
  if (type === 'password_reset_requested' && area === 'app') {
    const email = typeof p.email === 'string' ? p.email : 'A user';
    return {
      title: 'Password reset requested',
      body: `${email} asked to reset their password. Reset it from People and send them the link.`,
      action: { label: 'Open People', to: '/app/users', params: {} },
    };
  }
  // document_resubmit_required is legacy: old rows still exist.
  if (type === 'company_review_comment' || type === 'document_resubmit_required') {
    const name = typeof p.company_name === 'string' ? p.company_name : 'your company';
    return {
      title: 'Note from the rental team',
      body:
        typeof p.comment === 'string'
          ? `On ${name}: ${p.comment}`
          : `The rental team asked you to change something on ${name}.`,
      action: {
        label: 'Open company',
        to: '/account/companies/$companyId',
        params: { companyId: String(p.company_id ?? p.customer_id ?? '') },
      },
    };
  }
  if (type === 'company_verified' || type === 'company_rejected') {
    const name = typeof p.company_name === 'string' ? p.company_name : 'Your company';
    return type === 'company_verified'
      ? {
          title: 'Company verified',
          body: `${name} is verified. You can now book and pay for its rentals.`,
          action:
            typeof p.customer_id === 'string'
              ? { label: 'View company', to: '/account/companies/$companyId', params: { companyId: p.customer_id } }
              : { label: 'My applications', to: '/account/applications', params: {} },
        }
      : {
          title: 'Company not verified',
          body:
            typeof p.reason_label === 'string'
              ? `${name}: ${p.reason_label}. Open it to see which documents fix this, then reapply.`
              : `${name} could not be verified. Contact the rental team to fix it.`,
          action: {
            label: 'View company',
            to: '/account/companies/$companyId',
            params: { companyId: String(p.customer_id ?? '') },
          },
        };
  }
  if (typeof p.truck_request_id === 'string') {
    const code = typeof p.booking_code === 'string' ? p.booking_code : 'your truck request';
    const offer = typeof p.offer_php === 'number' ? ` with an offer of ${formatPeso(p.offer_php)}` : '';
    const bodies: Record<string, string> = {
      negotiation_reply: `The rental team replied on ${code}${offer}.`,
      call_confirmed: `${code} is confirmed by phone.`,
      truck_price_updated: `The rental team set the price of ${code} at ${typeof p.price_php === 'number' ? formatPeso(p.price_php) : 'a new figure'}${typeof p.previous_php === 'number' ? ` (was ${formatPeso(p.previous_php)})` : ''}. Accept it to pay.`,
      payment_received: `${code} is paid.`,
      truck_dispatched: `${code} is on its way${typeof p.eta_at === 'string' ? `; estimated arrival ${formatDateTime(p.eta_at)}` : ''}.`,
      payment_failed: `The payment for ${code} did not go through. Nothing was charged.`,
      payment_refunded: `A refund was issued on ${code}.`,
    };
    return {
      title: type === 'truck_price_updated' ? 'Price to accept' : formatStatus(type),
      body: bodies[type] ?? `${code} was updated.`,
      action: {
        label: 'Open trip',
        to: '/account/trucks',
        params: {},
        ...(typeof p.booking_code === 'string' ? { search: { open: p.booking_code } } : {}),
      },
    };
  }
  const rentalId = typeof p.rental_id === 'string' ? p.rental_id : null;
  if (!rentalId) {
    if (typeof p.invoice_id === 'string' && type.startsWith('payment_')) {
      return {
        title: formatStatus(type),
        body: 'An update on one of your payments.',
        action: { label: 'View invoice', to: '/account/invoices/$invoiceId', params: { invoiceId: p.invoice_id } },
      };
    }
    return null;
  }
  const ref = typeof p.booking_code === 'string' ? p.booking_code : 'your booking';
  const toNegotiation = { to: '/account/negotiation/$bookingId', params: { bookingId: rentalId } };
  const toBooking = { to: '/account/bookings/$bookingId', params: { bookingId: rentalId } };
  switch (type) {
    case 'quote_ready':
      return {
        title: 'Quote ready',
        body: `Your quote for booking ${ref} is ${formatPeso(p.total_php as number)}. Accept it or make a counter-offer.`,
        action: { label: 'Review quote', ...toNegotiation },
      };
    case 'negotiation_reply':
      return {
        title: 'Negotiation update',
        body:
          typeof p.offer_php === 'number'
            ? `The rental team replied on booking ${ref} with an offer of ${formatPeso(p.offer_php)}.`
            : `The rental team replied on booking ${ref}.`,
        action: { label: 'Open conversation', ...toNegotiation },
      };
    case 'payment_received':
      return {
        title: 'Payment received',
        body: `Booking ${ref} is paid and confirmed.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'payment_failed':
      return {
        title: 'Payment failed',
        body: `The payment for booking ${ref} did not go through. Nothing was charged; you can try again.`,
        action: {
          label: 'Try again',
          to: '/account/checkout/$bookingId',
          params: { bookingId: rentalId },
        },
      };
    case 'payment_refunded':
      return {
        title: 'Refund issued',
        body: `A refund was issued on booking ${ref}.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'equipment_delivered':
      return {
        title: 'Equipment delivered',
        body: `The equipment for booking ${ref} is on site. Your hire has started.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'equipment_returned':
      return {
        title: 'Equipment returned',
        body: `The equipment for booking ${ref} is back with the rental team. Your hire is complete.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'call_confirmed':
      return {
        title: 'Booking confirmed by phone',
        body: `Booking ${ref} is confirmed. You can pay for it now.`,
        action: { label: 'Pay now', to: '/account/checkout/$bookingId', params: { bookingId: rentalId } },
      };
    case 'booking_cancelled':
      return {
        title: 'Booking cancelled',
        body: `The rental team cancelled booking ${ref}. Any refund due is handled by the billing team.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'hold_expired':
      return {
        title: 'Booking request lapsed',
        body: `Booking ${ref} was not paid in time, so its dates were released and the request was cancelled. Nothing was charged; book again to pick new dates.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'deposit_low':
      return {
        title: 'Deposit running low',
        body: `Booking ${ref} has ${formatPeso(p.balance_php as number)} left of its ${formatPeso(p.deposit_php as number)} deposit. Hours past it are billed weekly.`,
        action: { label: 'View booking', ...toBooking },
      };
    case 'weekly_invoice':
      return {
        title: 'Weekly invoice',
        body: `Booking ${ref} used hours past its deposit: ${formatPeso(p.amount_php as number)} is due.`,
        action: { label: 'View invoice', to: '/account/invoices/$invoiceId', params: { invoiceId: String(p.invoice_id) } },
      };
    case 'daily_log_approved':
      return {
        title: 'Daily log approved',
        body: `${typeof p.report_date === 'string' ? p.report_date : 'A day'} on booking ${ref} was approved and is on your booking page.`,
        action: { label: 'View daily logs', ...toBooking },
      };
    case 'quote_accepted':
    case 'quote_declined':
      return { title: formatStatus(type), body: `Booking ${ref} was updated.`, action: { label: 'View booking', ...toBooking } };
    case 'change_request_resolved':
      return {
        title: p.decision === 'approved' ? 'Request approved' : 'Request declined',
        body: `Your ${p.kind === 'extend' ? 'extension' : 'cancellation'} request on booking ${ref} was ${p.decision === 'approved' ? 'approved' : 'declined'}.`,
        action: { label: 'View booking', ...toBooking },
      };
    default:
      return null;
  }
}

export type NotificationTone = 'success' | 'danger' | 'warning' | 'neutral';

function toneOf(type: string): NotificationTone {
  if (/(failed|rejected|mismatch|disputed|cancelled|declined)$/.test(type)) return 'danger';
  if (/(approved|verified|confirmed|accepted|delivered|paid|received)$/.test(type)) return 'success';
  if (type === 'deposit_low' || type === 'edtr_needs_correction' || type.startsWith('maintenance_') || type.includes('weather'))
    return 'warning';
  return 'neutral';
}

function categoryOf(type: string): string {
  if (/^(payment_|weekly_invoice|deposit_)/.test(type)) return 'Billing';
  if (type.startsWith('maintenance_')) return 'Maintenance';
  if (type.includes('weather')) return 'Weather';
  if (type.startsWith('truck_')) return 'Truck';
  if (/^(customer_message|negotiation_reply|company_review_comment)$/.test(type)) return 'Message';
  if (type.startsWith('edtr_') || type === 'daily_log_approved') return 'Field log';
  if (/^(company_|document_)/.test(type)) return 'Verification';
  if (/^(booking_|quote_|change_request_|call_|equipment_)/.test(type)) return 'Booking';
  return 'Update';
}

/** What the event is about and how it went: a word, not a pictogram. */
export function notificationKind(type: string): { label: string; tone: NotificationTone } {
  return { label: categoryOf(type), tone: toneOf(type) };
}

// Cloudscape status indicator: a small glyph in the status colour beside plain text.
// Warning yellow fails contrast as text, so only its glyph takes the colour.
const STATUS: Record<NotificationTone, { Icon: LucideIcon; icon: string; text: string }> = {
  success: { Icon: CircleCheck, icon: 'text-success', text: 'text-success' },
  danger: { Icon: CircleX, icon: 'text-error', text: 'text-error' },
  warning: { Icon: TriangleAlert, icon: 'text-warning', text: 'text-text' },
  neutral: { Icon: Info, icon: 'text-accent', text: 'text-text-muted' },
};

/** Unread rows sit on a faint accent wash, as the AWS console's notification list does. */
export function notificationRowClass(unread: boolean): string {
  return unread ? 'bg-accent/5' : '';
}

export function NotificationKindLabel({ type }: { type: string }) {
  const { label, tone } = notificationKind(type);
  const { Icon, icon, text } = STATUS[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${text}`}>
      <Icon aria-hidden="true" strokeWidth={2.5} className={`h-3.5 w-3.5 shrink-0 ${icon}`} />
      {label}
    </span>
  );
}

export function UnreadBadge() {
  return (
    <span className="rounded-full bg-accent px-2 py-px text-xs font-bold leading-4 text-text-inverse">New</span>
  );
}

const manilaDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function dayHeading(date: Date): string {
  const now = new Date();
  if (manilaDay(date) === manilaDay(now)) return 'Today';
  if (manilaDay(date) === manilaDay(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return formatDate(date);
}

// Newest first already, so consecutive runs of one day form a group.
function groupByDay(items: NotificationResponse[]): [string, NotificationResponse[]][] {
  const groups: [string, NotificationResponse[]][] = [];
  for (const item of items) {
    const heading = dayHeading(new Date(item.createdAt));
    const last = groups.at(-1);
    if (last?.[0] === heading) last[1].push(item);
    else groups.push([heading, [item]]);
  }
  return groups;
}

function NotificationRow({ notification, area }: { notification: NotificationResponse; area: FeedArea }) {
  const queryClient = useQueryClient();
  const isUnread = notification.status === 'unread';
  const createdAt = new Date(notification.createdAt).toISOString();
  const when = formatRelativeTime(createdAt);
  const described = describeNotification(notification.notificationType, notification.payload, area);

  const markRead = useMutation({
    mutationFn: () => apiPatch(`/notifications/${notification.id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const content = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="flex items-center gap-2">
        <NotificationKindLabel type={notification.notificationType} />
        {isUnread && <UnreadBadge />}
      </p>
      <p className={`text-sm text-text ${isUnread ? 'font-bold' : ''}`}>
        {described?.title ?? formatStatus(notification.notificationType)}
      </p>
      {described ? (
        <p className="text-sm text-text-muted">{described.body}</p>
      ) : (
        payloadLines(notification.payload).map((line) => (
          <p key={line} className="text-sm text-text-muted">
            {line}
          </p>
        ))
      )}
      {described?.action && (
        <span className="mt-1 text-sm font-medium text-accent underline-offset-2 group-hover:underline">
          {described.action.label}
        </span>
      )}
    </div>
  );

  return (
    <li
      className={[
        'flex items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0',
        notificationRowClass(isUnread),
      ].join(' ')}
    >
      {described?.action ? (
        <Link
          to={described.action.to}
          params={described.action.params}
          {...(described.action.search ? { search: described.action.search } : {})}
          onClick={() => isUnread && markRead.mutate()}
          className="group min-w-0 flex-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
        >
          {content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <time dateTime={createdAt} title={when?.absolute} className="font-mono text-xs tabular-nums text-text-muted">
          {when?.relative ?? '--'}
        </time>
        {isUnread && (
          <button
            type="button"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate()}
            className="min-h-6 text-xs font-medium text-text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-50"
          >
            Mark read
          </button>
        )}
      </div>
    </li>
  );
}

export function NotificationFeed() {
  const [offset, setOffset] = useState(0);
  const area = feedAreaOf(useRouterState({ select: (s) => s.location.pathname }));
  const query = useQuery(notificationsQueries.list(PAGE_SIZE, offset));
  const queryClient = useQueryClient();
  const markAll = useMutation({
    mutationFn: () => apiPatch('/notifications/read-all', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (query.isPending) return <Skeleton label="Loading notifications" />;

  if (query.isError)
    return (
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 border-error p-4">
        <p className="text-sm text-error">
          Notifications could not be loaded just now. Check your connection and try again.
        </p>
        <Button variant="secondary" onClick={() => query.refetch()}>
          Retry
        </Button>
      </Surface>
    );

  if (query.data.total === 0)
    return (
      <EmptyState
        title="Nothing needs you right now"
        description="Quotes, replies, payments and alerts land here as they happen."
      />
    );

  return (
    <Surface radius="md" elevation="sm" className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-heading-md text-text">
          Inbox <span className="font-mono text-sm font-normal tabular-nums text-text-muted">{query.data.total}</span>
        </h2>
        <div className="flex items-center gap-3">
          {query.data.items.some((item) => item.status === 'unread') && (
            <Button
              variant="secondary"
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all as read
            </Button>
          )}
        </div>
      </div>
      {groupByDay(query.data.items).map(([heading, items]) => (
        <section key={heading} aria-label={heading}>
          <h3 className="border-b border-border bg-surface-sunk px-4 py-2 text-sm font-bold text-text">
            {heading}
          </h3>
          <ul>
            {items.map((item) => (
              <NotificationRow key={item.id} notification={item} area={area} />
            ))}
          </ul>
        </section>
      ))}
      <Pagination
        offset={offset}
        limit={PAGE_SIZE}
        total={query.data.total}
        onOffsetChange={setOffset}
        noun="notifications"
        busy={query.isFetching}
      />
    </Surface>
  );
}
