import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import {
  REJECTION_REASON_LABELS,
  WEATHER_LEVEL_ACTIONS,
  WEATHER_LEVEL_LABELS,
  type NotificationListResponse,
  type NotificationResponse,
  type RejectionReason,
  type WeatherLevel,
} from '@arkilaunch/shared';
import { apiGet, apiPatch } from '../lib/api-client.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { BellIcon } from './icons.js';
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
  action?: { label: string; to: string; params: Record<string, string> };
}

export function describeNotification(type: string, payload: unknown): Described | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
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
            typeof p.rejection_reason === 'string' && p.rejection_reason in REJECTION_REASON_LABELS
              ? `${name}: ${REJECTION_REASON_LABELS[p.rejection_reason as RejectionReason]}. See what to upload to reapply.`
              : `${name} could not be verified. Contact the rental team to fix it.`,
          action: { label: 'View company', to: '/account/companies', params: {} },
        };
  }
  if (type === 'equipment_weather_warning' && typeof p.rental_id === 'string') {
    const level = typeof p.level === 'string' && p.level in WEATHER_LEVEL_LABELS ? (p.level as WeatherLevel) : 'caution';
    const reasons = Array.isArray(p.reasons) ? ` (${(p.reasons as string[]).join('; ')})` : '';
    return {
      title: `${WEATHER_LEVEL_LABELS[level]}: ${typeof p.equipment === 'string' ? p.equipment : 'your machine'}`,
      body: `${WEATHER_LEVEL_ACTIONS[level]}${reasons}`,
      action: { label: 'Open booking', to: '/account/bookings/$bookingId', params: { bookingId: p.rental_id } },
    };
  }
  if (type === 'truck_requested' || (type === 'call_requested' && typeof p.truck_request_id === 'string')) {
    return {
      title: type === 'truck_requested' ? 'New truck request' : 'Call requested',
      body: type === 'truck_requested' ? 'A customer requested a self-loading truck.' : 'A customer asked for a call about their truck request.',
      action: { label: 'Open trucks', to: '/app/trucks', params: {} },
    };
  }
  if ((type === 'negotiation_reply' || type === 'customer_message') && typeof p.truck_request_id === 'string') {
    const staffSide = type === 'customer_message';
    const offer = typeof p.offer_php === 'number' ? ` with an offer of ${formatPeso(p.offer_php)}` : '';
    return {
      title: staffSide ? 'Customer message' : 'Negotiation update',
      body: staffSide
        ? `A customer replied on a truck request${offer}.`
        : `The rental team replied on your truck request${offer}.`,
      action: staffSide
        ? { label: 'Open trucks', to: '/app/trucks', params: {} }
        : { label: 'Open truck requests', to: '/account/trucks', params: {} },
    };
  }
  if ((type === 'payment_paid' || type === 'payment_failed' || type === 'payment_disputed') && typeof p.rental_id !== 'string') {
    const what = type === 'payment_paid' ? 'was paid' : type === 'payment_failed' ? 'failed' : 'is disputed';
    return {
      title: `Payment ${type.slice('payment_'.length)}`,
      body: `An online payment ${what}.`,
      action: { label: 'Open payments', to: '/app/payments', params: {} },
    };
  }
  const rentalId = typeof p.rental_id === 'string' ? p.rental_id : null;
  if (!rentalId) return null;
  const ref = shortCode('booking', rentalId);
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

function NotificationRow({ notification }: { notification: NotificationResponse }) {
  const queryClient = useQueryClient();
  const isUnread = notification.status === 'unread';
  const when = formatRelativeTime(new Date(notification.createdAt).toISOString());
  const described = describeNotification(notification.notificationType, notification.payload);

  const markRead = useMutation({
    mutationFn: () => apiPatch(`/notifications/${notification.id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={[
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-md',
            isUnread ? 'bg-primary text-on-primary' : 'bg-surface-sunk text-text-muted',
          ].join(' ')}
        >
          <BellIcon />
        </span>
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
            <Link
              to={described.action.to}
              params={described.action.params}
              onClick={() => isUnread && markRead.mutate()}
              className="mt-2 inline-block"
            >
              <Button variant="primary">{described.action.label}</Button>
            </Link>
          )}
        </div>
      </div>

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
          <NotificationRow key={item.id} notification={item} />
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
