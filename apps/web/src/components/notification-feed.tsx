import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import { WEATHER_LEVEL_INFO, type NotificationListResponse, type NotificationResponse } from '@arkilaunch/shared';
import { apiGet, apiPatch } from '../lib/api-client.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import {
  Bell,
  CalendarDays,
  CircleCheck,
  CircleX,
  Clock,
  MessageSquare,
  ReceiptText,
  TriangleAlert,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Pagination, PAGE_SIZE } from './pagination.js';
import { formatRelativeTime } from '../lib/format-time.js';
import { formatPeso, formatStatus, shortCode } from '../lib/format.js';
import { Skeleton } from './skeleton.js';

export const notificationQueries = {
  list: (limit = 20, offset = 0) =>
    queryOptions({
      queryKey: ['notifications', limit, offset] as const,
      queryFn: () =>
        apiGet<NotificationListResponse>(`/notifications?limit=${limit}&offset=${offset}`),
    }),
};

// The payload column is typed `unknown` in the shared schema on purpose --
// each notification type writes its own shape, and the only current writer
// (jobs/src/maintenance-notify.ts) stores equipment_id/threshold/
// runtime_hours. Read it defensively: an unrecognised payload still renders
// its type, time and read state rather than crashing the feed or, worse,
// printing "[object Object]".
function payloadLines(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && typeof value !== 'object')
    // The booking code names the booking; its raw ids add nothing.
    .filter(([key]) => !('booking_code' in (payload as object)) || !key.endsWith('_id'))
    .map(([key, value]) => {
      const label = formatStatus(key);
      if (key.endsWith('_id') && typeof value === 'string') {
        return `${label}: ${shortCode('equipment', value)}`;
      }
      return `${label}: ${String(value)}`;
    });
}

// The customer-journey events (bookings/quotes/payments services write
// these) get a sentence and a destination; anything else falls back to the
// generic type + payload rendering above.
interface Described {
  title: string;
  body: string;
  action?: { label: string; to: string; params: Record<string, string>; search?: Record<string, string> };
}

// Which console the feed is mounted in: the same notification type links to
// the admin's screen or the customer's.
export type FeedArea = 'app' | 'account' | 'field' | 'admin';

export function feedAreaOf(pathname: string): FeedArea {
  const first = pathname.split('/')[1];
  return first === 'account' || first === 'field' || first === 'admin' ? first : 'app';
}

// Staff open a booking in the drawer by its code; the full page is the
// fallback for a row that somehow has no code.
function staffBooking(p: Record<string, unknown>, label = 'Open booking'): NonNullable<Described['action']> {
  const code = typeof p.booking_code === 'string' ? p.booking_code : null;
  if (code) return { label, to: '/app/bookings', params: {}, search: { open: code } };
  const rentalId = typeof p.rental_id === 'string' ? p.rental_id : null;
  return rentalId
    ? { label, to: '/app/bookings/$bookingId', params: { bookingId: rentalId } }
    : { label, to: '/app/bookings', params: {} };
}

// Staff-side types (written by notifyStaff). Every one has a destination
// (cr-arkilaunch-uniform-booking-codes.md, admin feedback item 4).
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
        action: staffBooking(p),
      };
    case 'customer_message': {
      const offer = typeof p.offer_php === 'number' ? ` with an offer of ${formatPeso(p.offer_php)}` : '';
      return { title: 'Customer message', body: `The customer replied on ${ref}${offer}.`, action: staffBooking(p, 'Open conversation') };
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
        action: staffBooking(p, 'Review request'),
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
        action: { label: 'Open payments', to: '/app/payments', params: {} },
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
        action: { label: 'Open inventory', to: '/app/inventory', params: {} },
      };
    case 'weather_advisory':
      return { title: 'Weather advisory', body: 'A site is under a weather advisory.', action: { label: 'Open incidents', to: '/app/incidents', params: {} } };
    default:
      return null;
  }
}

// The timekeeper's feed: their submissions' outcomes and site weather.
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
        action: { ...toDashboard, label: 'Resubmit' },
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

export function describeNotification(type: string, payload: unknown, area: FeedArea = 'app'): Described | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (area === 'field') return describeForField(type, p);
  if (area === 'app' || area === 'admin') {
    const staff = describeForStaff(type, p);
    if (staff) return staff;
  }
  if (type === 'password_reset_requested') {
    const email = typeof p.email === 'string' ? p.email : 'A user';
    return {
      title: 'Password reset requested',
      body: `${email} asked to reset their password. Reset it from People and send them the link.`,
      action: { label: 'Open People', to: '/app/users', params: {} },
    };
  }
  if (type === 'company_submitted') {
    const name = typeof p.company_name === 'string' ? p.company_name : 'A company';
    return {
      title: 'New company registration',
      body: `${name} needs approval.`,
      action: { label: 'Review', to: '/app/registration/pending', params: {} },
    };
  }
  // document_resubmit_required is no longer written; old rows read as the
  // reviewer's note it has become.
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
          body: `${name} is verified. You can now pay for its bookings.`,
          action: { label: 'My bookings', to: '/account/bookings', params: {} },
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
  if (type === 'equipment_weather_warning' || type === 'equipment_weather_alert') {
    const level = typeof p.level === 'string' && p.level in WEATHER_LEVEL_INFO ? (p.level as keyof typeof WEATHER_LEVEL_INFO) : 'caution';
    const info = WEATHER_LEVEL_INFO[level];
    const name = typeof p.equipment_name === 'string' ? p.equipment_name : 'A machine';
    const why = Array.isArray(p.reasons) && p.reasons.length ? ` ${(p.reasons as string[]).join('; ')}.` : '';
    const bookingId = String(p.rental_id ?? '');
    return {
      title: `${info.label.toUpperCase()}: ${name}`,
      body: type === 'equipment_weather_warning' ? `${why} ${info.action} ${info.tagalog}`.trim() : `${name} on a customer site is at ${info.label}.${why}`,
      action:
        type === 'equipment_weather_warning'
          ? { label: 'Open booking', to: '/account/bookings/$bookingId', params: { bookingId } }
          : { label: 'Open booking', to: '/app/bookings/$bookingId', params: { bookingId } },
    };
  }
  if (type === 'company_reapplied') {
    const name = typeof p.company_name === 'string' ? p.company_name : 'A company';
    return {
      title: 'Registration resubmitted',
      body: `${name} uploaded new documents after a rejection and needs a fresh decision.`,
      action: { label: 'Review', to: '/app/registration/pending', params: {} },
    };
  }
  // A customer's truck trip: every update opens their truck requests.
  if (typeof p.truck_request_id === 'string') {
    const code = typeof p.booking_code === 'string' ? p.booking_code : 'your truck request';
    const offer = typeof p.offer_php === 'number' ? ` with an offer of ${formatPeso(p.offer_php)}` : '';
    const bodies: Record<string, string> = {
      negotiation_reply: `The rental team replied on ${code}${offer}.`,
      call_confirmed: `${code} is confirmed by phone. You can pay for it now.`,
      payment_received: `${code} is paid.`,
      payment_failed: `The payment for ${code} did not go through. Nothing was charged.`,
      payment_refunded: `A refund was issued on ${code}.`,
    };
    return {
      title: formatStatus(type),
      body: bodies[type] ?? `${code} was updated.`,
      action: { label: 'Open truck requests', to: '/account/trucks', params: {} },
    };
  }
  const rentalId = typeof p.rental_id === 'string' ? p.rental_id : null;
  if (!rentalId) {
    // A payment keyed only by its invoice still has somewhere to go.
    if (typeof p.invoice_id === 'string' && type.startsWith('payment_')) {
      return {
        title: formatStatus(type),
        body: 'An update on one of your payments.',
        action: { label: 'View invoice', to: '/account/invoices/$invoiceId', params: { invoiceId: p.invoice_id } },
      };
    }
    return null;
  }
  // booking_code is added to every booking notification by the database
  // (migration 0058), including rows written before it.
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
    case 'call_requested':
      return {
        title: 'Call requested',
        body: `The customer on booking ${ref} asked for a call before paying.`,
        action: { label: 'Open booking', to: '/app/bookings/$bookingId', params: { bookingId: rentalId } },
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

// The icon names the kind of event, the tone says how it went. Same tints
// as StatusBadge (DESIGN.md §6: never colour alone, the icon carries it).
export type NotificationTone = 'success' | 'danger' | 'warning' | 'neutral';

export function notificationIcon(type: string): { Icon: LucideIcon; tone: NotificationTone } {
  if (/(failed|rejected|mismatch|disputed|cancelled|declined)$/.test(type)) return { Icon: CircleX, tone: 'danger' };
  if (/^(payment_|weekly_invoice)/.test(type)) {
    return { Icon: ReceiptText, tone: /(paid|received)$/.test(type) ? 'success' : 'neutral' };
  }
  if (type === 'deposit_low') return { Icon: ReceiptText, tone: 'warning' };
  if (type.startsWith('maintenance_')) return { Icon: Wrench, tone: 'warning' };
  if (type.includes('weather')) return { Icon: TriangleAlert, tone: 'warning' };
  if (/(approved|verified|confirmed|accepted|delivered)$/.test(type)) return { Icon: CircleCheck, tone: 'success' };
  if (type.startsWith('truck_')) return { Icon: Truck, tone: 'neutral' };
  if (/^(customer_message|negotiation_reply|company_review_comment|document_resubmit_required)$/.test(type)) {
    return { Icon: MessageSquare, tone: 'neutral' };
  }
  if (type.startsWith('edtr_') || type === 'daily_log_approved') {
    return { Icon: Clock, tone: type === 'edtr_needs_correction' ? 'warning' : 'neutral' };
  }
  if (/^(booking_|quote_|change_request_|call_|equipment_)/.test(type)) return { Icon: CalendarDays, tone: 'neutral' };
  return { Icon: Bell, tone: 'neutral' };
}

const TONE_CLASS: Record<NotificationTone, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-error/10 text-error',
  // Warning yellow fails contrast as text; the tint carries it.
  warning: 'bg-warning/20 text-text',
  neutral: 'bg-primary text-on-primary',
};

export function NotificationIcon({ type, unread, className = '' }: { type: string; unread: boolean; className?: string }) {
  const { Icon, tone } = notificationIcon(type);
  return (
    <span
      aria-hidden="true"
      className={[
        'flex shrink-0 items-center justify-center rounded-md',
        unread ? TONE_CLASS[tone] : 'bg-surface-sunk text-text-muted',
        className,
      ].join(' ')}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

function NotificationRow({ notification, area }: { notification: NotificationResponse; area: FeedArea }) {
  const queryClient = useQueryClient();
  const isUnread = notification.status === 'unread';
  const when = formatRelativeTime(new Date(notification.createdAt).toISOString());
  const described = describeNotification(notification.notificationType, notification.payload, area);

  const markRead = useMutation({
    mutationFn: () => apiPatch(`/notifications/${notification.id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const content = (
    <>
        <NotificationIcon type={notification.notificationType} unread={isUnread} className="h-11 w-11" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
              {described?.title ?? formatStatus(notification.notificationType)}
            </span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-border" />
            <span className="font-mono text-xs text-text-muted">
              {shortCode('log', notification.id)}
            </span>
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
            <span className="mt-1 inline-block text-sm font-semibold text-accent">
              {described.action.label} <span aria-hidden="true">→</span>
            </span>
          )}
        </div>
    </>
  );

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 last:border-b-0">
      {described?.action ? (
        <Link
          to={described.action.to}
          params={described.action.params}
          {...(described.action.search ? { search: described.action.search } : {})}
          onClick={() => isUnread && markRead.mutate()}
          className="-m-2 flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3">{content}</div>
      )}

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-right text-sm text-text-muted" title={when?.absolute}>
          {when?.relative.replace('Reported ', '') ?? '--'}
        </span>
        {isUnread && (
          <Button
            variant="secondary"
            loading={markRead.isPending}
            onClick={() => markRead.mutate()}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

// One feed, three mount points: the admin console, the customer account and
// the field console all read the same tenant-scoped GET /notifications.
// The Figma frames (168:3011, 276:7669, 359:2970) differ only in their
// surrounding shell, which the layout routes already supply.
export function NotificationFeed() {
  // "Load more" grew the page size and re-requested from offset 0, so
  // reaching the fourth page re-fetched the first three, and there was no
  // way back up a long feed. Every other list in the console pages through
  // the same server limit/offset; this one now does too.
  const [offset, setOffset] = useState(0);
  const area = feedAreaOf(useRouterState({ select: (s) => s.location.pathname }));
  const query = useQuery(notificationQueries.list(PAGE_SIZE, offset));
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
        <h2 className="font-display text-base font-semibold text-text">Pending items</h2>
        <div className="flex items-center gap-3">
          <p className="text-sm text-text-muted">{query.data.total} in total</p>
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
      <div>
        {query.data.items.map((item) => (
          <NotificationRow key={item.id} notification={item} area={area} />
        ))}
      </div>
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
