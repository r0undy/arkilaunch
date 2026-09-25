import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse, BookingSummaryResponse, RescheduleSuggestion } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { bookingsQueries } from '../lib/queries.js';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { NegotiationThread } from '../components/negotiation-thread.js';
import { EdtrSheetCard } from '../components/edtr-sheet-card.js';
import { useToast } from '../components/toast.js';
import { formatDate, formatPeso, formatStatus, shortCode, siteName } from '../lib/format.js';

// The staff side of the customer journey: the same negotiation thread the
// customer sees, the change requests only staff can resolve, and a way
// into the quote builder with the booking already attached. The API
// scopes all of it by role; this screen only arranges it.

const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';

const COLUMNS: TableColumn<BookingSummaryResponse>[] = [
  {
    header: 'Booking',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="font-mono text-text">{shortCode('booking', row.id)}</span>
        <span className="text-xs text-text-muted">
          {row.siteCity ?? row.siteProvince ?? siteName({ id: row.projectSiteId })}
        </span>
      </div>
    ),
  },
  { header: 'Status', cell: (row) => formatStatus(row.status) },
  {
    header: 'Details',
    cell: (row) => (
      <Link to="/app/bookings/$bookingId" params={{ bookingId: row.id }} className="font-semibold text-accent underline">
        Open
      </Link>
    ),
  },
];

function BookingsPage() {
  const [offset, setOffset] = useState(0);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Billing" title="Bookings" description="Customer bookings, their negotiation and their requests." />
      <DataPanel
        title="Bookings"
        options={bookingsQueries.list(PAGE_SIZE, offset)}
        emptyTitle="No bookings yet"
        emptyDescription="Bookings customers request from the storefront appear here."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
            <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="bookings" />
          </div>
        )}
      />
    </div>
  );
}

function PendingRequests({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      apiPatch(`/bookings/${booking.id}/change-requests/${id}`, { decision }),
    onSuccess: async (_data, { decision }) => {
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      toast.success(decision === 'approved' ? 'Request approved' : 'Request declined', 'The customer has been notified.');
    },
    onError: (err) => toast.error('Could not resolve the request', apiErrorText(err)),
  });

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <h2 className={heading}>Change requests</h2>
      {booking.changeRequests.length === 0 && <p className="text-sm text-text-muted">None.</p>}
      {booking.changeRequests.map((request) => (
        <div key={request.id} className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <p className="text-sm text-text">
            {request.kind === 'extend' ? `Extend to ${formatDate(request.requestedEnd)}` : 'Cancel booking'}
            <span className="text-text-muted"> &middot; {formatStatus(request.status)}</span>
          </p>
          {request.reason && <p className="text-sm text-text-muted">{request.reason}</p>}
          {request.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="approve" loading={resolve.isPending} onClick={() => resolve.mutate({ id: request.id, decision: 'approved' })}>
                Approve
              </Button>
              <Button variant="secondary" loading={resolve.isPending} onClick={() => resolve.mutate({ id: request.id, decision: 'rejected' })}>
                Decline
              </Button>
            </div>
          )}
          {request.kind === 'cancel' && request.status === 'pending' && booking.status === 'confirmed' && (
            <p className="text-xs text-text-muted">This booking is paid: issue any refund in the PayMongo dashboard.</p>
          )}
        </div>
      ))}
    </Surface>
  );
}

// When a confirmed booking must move: the nearest free same-length window on
// each unit, then other free units of the same type. Advice only; staff
// agree the move with the customer in the thread.
function RescheduleCard({ bookingId }: { bookingId: string }) {
  const suggest = useMutation({
    mutationFn: () => apiGet<RescheduleSuggestion>(`/bookings/${bookingId}/reschedule-suggestion`),
  });
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5 text-sm">
      <h2 className={heading}>Reschedule</h2>
      <div>
        <Button variant="secondary" loading={suggest.isPending} onClick={() => suggest.mutate()}>
          Suggest a new slot
        </Button>
      </div>
      {suggest.isError && <p className="text-error">{apiErrorText(suggest.error)}</p>}
      {suggest.data?.items.map((item) => (
        <div key={item.equipmentId} className="flex flex-col gap-1">
          <p className="text-text">
            {shortCode('equipment', item.equipmentId)}:{' '}
            {item.sameUnit
              ? `${new Date(item.sameUnit.start).toLocaleString()} - ${new Date(item.sameUnit.end).toLocaleString()}`
              : 'no free window within 60 days'}
          </p>
          <p className="text-text-muted">
            Other free units:{' '}
            {item.alternatives.length ? item.alternatives.map((id) => shortCode('equipment', id)).join(', ') : 'none'}
          </p>
        </div>
      ))}
    </Surface>
  );
}

// Checkout stays closed until staff have phoned the customer.
function CallCard({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => apiPost(`/bookings/${booking.id}/call-confirmed`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      toast.success('Confirmed by phone', 'The customer can now pay.');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <h2 className={heading}>Phone confirmation</h2>
      <p className="text-sm text-text-muted">
        {booking.callConfirmedAt
          ? `Confirmed ${formatDate(booking.callConfirmedAt)}.`
          : booking.callRequestedAt
            ? 'The customer asked for a call.'
            : 'Call the customer before they pay.'}
      </p>
      {!booking.callConfirmedAt && booking.status !== 'cancelled' && (
        <Button variant="secondary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
          Confirmed by phone
        </Button>
      )}
    </Surface>
  );
}

// Staff mark a paid booking delivered (machines on site, field sheet
// unlocked) and later returned. Both endpoints already guard the status.
function DeliveryCard({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (step: 'deliver' | 'return') => apiPost(`/bookings/${booking.id}/${step}`, {}),
    onSuccess: (_data, step) => {
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      toast.success(step === 'deliver' ? 'Marked delivered' : 'Marked returned');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
  if (booking.status !== 'confirmed' && booking.status !== 'active') return null;
  const deliver = booking.status === 'confirmed';
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <h2 className={heading}>Delivery</h2>
      <p className="text-sm text-text-muted">
        {deliver ? 'Paid. Mark delivered once the machines are on site.' : 'On site. Mark returned once every machine is back.'}
      </p>
      <Button variant="primary" loading={move.isPending} onClick={() => move.mutate(deliver ? 'deliver' : 'return')}>
        {deliver ? 'Mark delivered' : 'Mark returned'}
      </Button>
    </Surface>
  );
}

function BookingSide({ booking }: { booking: BookingDetailResponse }) {
  const quote = booking.quotation;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CallCard booking={booking} />
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
        <h2 className={heading}>Quote</h2>
        {quote ? (
          <p className="text-sm text-text">
            Revision {quote.revision} &middot; {formatStatus(quote.status)} &middot;{' '}
            <span className="font-mono">{formatPeso(quote.totalPhp)}</span>
          </p>
        ) : (
          <p className="text-sm text-text-muted">Not quoted yet.</p>
        )}
        {booking.status !== 'cancelled' && quote?.status !== 'accepted' && (
          <Link to="/app/quotes" search={{ bookingId: booking.id, customerId: booking.customerId }}>
            <Button variant="primary">{quote ? 'Send a revised quote' : 'Quote this booking'}</Button>
          </Link>
        )}
        {quote && (
          <Link to="/app/quotes/$quoteId/print" params={{ quoteId: quote.id }}>
            <Button variant="secondary">Print quote</Button>
          </Link>
        )}
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5 text-sm">
        <h2 className={heading}>Site</h2>
        <p className="text-text">{booking.siteCity ?? booking.siteProvince ?? '--'}</p>
        {booking.siteContact && <p className="text-text-muted">Contact: {booking.siteContact}</p>}
        {booking.siteNotes && <p className="text-text-muted">Access: {booking.siteNotes}</p>}
        {booking.items.map((item) => (
          <p key={`${item.equipmentId}-${String(item.start)}`} className="text-text-muted">
            {shortCode('equipment', item.equipmentId)}: {formatDate(item.start)} - {formatDate(item.end)}
          </p>
        ))}
      </Surface>
      <DeliveryCard booking={booking} />
      {/* The field sheet is for machines on site: hidden until delivered. */}
      {['active', 'completed'].includes(booking.status) && <EdtrSheetCard bookingId={booking.id} printable />}
      <PendingRequests booking={booking} />
      {booking.status === 'confirmed' && <RescheduleCard bookingId={booking.id} />}
    </div>
  );
}

function BookingPage() {
  const { bookingId } = appBookingRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Bookings"
        title={`Booking ${shortCode('booking', bookingId)}`}
        {...(booking.data ? { description: formatStatus(booking.data.status) } : {})}
        actions={
          <Link to="/app/bookings">
            <Button variant="ghost">All bookings</Button>
          </Link>
        }
      />
      {booking.isError && <p className="text-sm text-error">{apiErrorText(booking.error)}</p>}
      {booking.data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <NegotiationThread bookingId={bookingId} disabled={booking.data.status === 'cancelled'} />
          <BookingSide booking={booking.data} />
        </div>
      )}
    </div>
  );
}

export const appBookingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/bookings',
  component: BookingsPage,
});

export const appBookingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/bookings/$bookingId',
  component: BookingPage,
});
