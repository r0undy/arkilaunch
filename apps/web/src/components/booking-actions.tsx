import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse, RescheduleSuggestion } from '@arkilaunch/shared';
import { bookingsQueries } from '../lib/queries.js';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { formatDate, formatPeso, formatStatus, shortCode } from '../lib/format.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { SiteProofAdmin } from './site-proof.js';
import { SiteEquipmentWeather } from './equipment-weather.js';
import { EdtrSheetCard } from './edtr-sheet-card.js';
import { useToast } from './toast.js';

// The staff actions on one rental booking: phone confirmation, quote, site,
// delivery, change requests and rescheduling. Shared by the booking
// drawer's Actions tab and the full /app/bookings/$bookingId page. The API
// guards every status; these cards only arrange it.

const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';

function PendingRequests({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      apiPatch(`/bookings/${booking.id}/change-requests/${id}`, { decision }),
    onSuccess: async (_data, { decision }) => {
      setAsk(null);
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      toast.success(decision === 'approved' ? 'Request approved' : 'Request declined', 'The customer has been notified.');
    },
    onError: (err) => {
      setAsk(null);
      toast.error('Could not resolve the request', apiErrorText(err));
    },
  });
  // Approving an extension moves the booking's end date; approving a
  // cancellation cancels it. Neither undoes, so each asks first.
  const [ask, setAsk] = useState<{ request: BookingDetailResponse['changeRequests'][number]; decision: 'approved' | 'rejected' } | null>(null);

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
              <Button variant="approve" disabled={resolve.isPending} onClick={() => setAsk({ request, decision: 'approved' })}>
                Approve
              </Button>
              <Button variant="secondary" disabled={resolve.isPending} onClick={() => setAsk({ request, decision: 'rejected' })}>
                Decline
              </Button>
            </div>
          )}
          {request.kind === 'cancel' && request.status === 'pending' && booking.status === 'confirmed' && (
            <p className="text-xs text-text-muted">This booking is paid: issue any refund in the PayMongo dashboard.</p>
          )}
        </div>
      ))}
      <ConfirmDialog
        open={ask !== null}
        tone={ask?.decision === 'approved' ? 'approve' : 'danger'}
        title={
          ask?.decision === 'approved'
            ? ask.request.kind === 'extend'
              ? 'Approve this extension?'
              : 'Approve this cancellation?'
            : 'Decline this request?'
        }
        body={
          ask?.decision === 'approved'
            ? ask.request.kind === 'extend'
              ? `The booking will run to ${formatDate(ask.request.requestedEnd)}. The customer is notified.`
              : 'The booking is cancelled for good. The customer is notified.'
            : 'The booking stays as it is. The customer is notified that you declined.'
        }
        confirmLabel={ask?.decision === 'approved' ? 'Approve' : 'Decline'}
        pending={resolve.isPending}
        onConfirm={() => {
          if (ask) resolve.mutate({ id: ask.request.id, decision: ask.decision });
        }}
        onCancel={() => setAsk(null)}
      />
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
  const [asking, setAsking] = useState(false);
  const confirm = useMutation({
    mutationFn: () => apiPost(`/bookings/${booking.id}/call-confirmed`, {}),
    onSuccess: () => {
      setAsking(false);
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
        <Button variant="secondary" loading={confirm.isPending} onClick={() => setAsking(true)}>
          Confirmed by phone
        </Button>
      )}
      <ConfirmDialog
        open={asking}
        tone="approve"
        title="Mark as confirmed by phone?"
        body={<p>Only once you have spoken to the customer: it opens checkout for this booking.</p>}
        confirmLabel="Yes, we spoke"
        pending={confirm.isPending}
        onConfirm={() => confirm.mutate()}
        onCancel={() => setAsking(false)}
      />
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
      setAsking(false);
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(step === 'deliver' ? 'Marked delivered' : 'Marked returned');
    },
    onError: (e) => {
      setAsking(false);
      toast.error('Not saved', apiErrorText(e));
    },
  });
  const [asking, setAsking] = useState(false);
  if (booking.status !== 'confirmed' && booking.status !== 'active') return null;
  const deliver = booking.status === 'confirmed';
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <h2 className={heading}>Delivery</h2>
      <p className="text-sm text-text-muted">
        {deliver ? 'Paid. Mark delivered once the machines are on site.' : 'On site. Mark returned once every machine is back.'}
      </p>
      <Button variant="primary" onClick={() => setAsking(true)}>
        {deliver ? 'Mark delivered' : 'Mark returned'}
      </Button>
      <ConfirmDialog
        open={asking}
        title={deliver ? 'Mark this booking delivered?' : 'Mark this booking returned?'}
        body={
          deliver
            ? 'Only once every machine is on site: this starts the rental on site and opens the field sheet.'
            : 'Only once every machine is back: this closes the booking.'
        }
        confirmLabel={deliver ? 'Mark delivered' : 'Mark returned'}
        pending={move.isPending}
        onConfirm={() => move.mutate(deliver ? 'deliver' : 'return')}
        onCancel={() => setAsking(false)}
      />
    </Surface>
  );
}

export function BookingSide({ booking }: { booking: BookingDetailResponse }) {
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
        {quote && quote.status === 'approved' && !quote.inNegotiation && (
          <p className="text-sm text-text-muted">Priced from the price book and sent. You can revise it once the customer negotiates.</p>
        )}
        {/* No quote: the price book could not price it (no rate card), so staff quote it once. */}
        {booking.status !== 'cancelled' && (!quote || quote.inNegotiation) && (
          <Link to="/app/quotes" search={{ bookingId: booking.id }}>
            <Button variant="primary">{quote ? 'Revise quote' : 'Quote this booking'}</Button>
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
        <SiteProofAdmin siteId={booking.projectSiteId} />
        {booking.status === 'active' && <SiteEquipmentWeather siteId={booking.projectSiteId} />}
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
