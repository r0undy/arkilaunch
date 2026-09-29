import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse, RescheduleSuggestion } from '@arkilaunch/shared';
import { localPhMobile } from '@arkilaunch/shared';
import { bookingsQueries } from '../lib/queries.js';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { formatDate, formatDateTime, formatPeso, formatStatus } from '../lib/format.js';
import { Container } from './container.js';
import { Alert } from './alert.js';
import { Button, buttonClass } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { SiteProofAdmin } from './site-proof.js';
import { SiteEquipmentWeather } from './equipment-weather.js';
import { EdtrSheetCard } from './edtr-sheet-card.js';
import { useToast } from './toast.js';



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
  const [ask, setAsk] = useState<{ request: BookingDetailResponse['changeRequests'][number]; decision: 'approved' | 'rejected' } | null>(null);

  return (
    <Container header={{ title: 'Change requests' }}>
      <div className="flex flex-col gap-3">
      {booking.changeRequests.length === 0 && <p className="text-sm text-text-muted">None.</p>}
      {booking.changeRequests.map((request) => (
        <div key={request.id} className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <p className="text-sm text-text">
            {request.kind === 'extend'
              ? `Extend ${booking.items.find((item) => item.id === request.assignmentId)?.equipmentName ?? 'all machines'} to ${formatDate(request.requestedEnd)}`
              : 'Cancel booking'}
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
              ? `${booking.items.find((item) => item.id === ask.request.assignmentId)?.equipmentName ?? 'Every machine'} will run to ${formatDate(ask.request.requestedEnd)}; other machines keep their dates. The customer is notified.`
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
      </div>
    </Container>
  );
}

function RescheduleCard({ booking }: { booking: BookingDetailResponse }) {
  const bookingId = booking.id;
  const nameOf = (id: string) => booking.items.find((i) => i.equipmentId === id)?.equipmentName ?? 'This machine';
  const suggest = useMutation({
    mutationFn: () => apiGet<RescheduleSuggestion>(`/bookings/${bookingId}/reschedule-suggestion`),
  });
  return (
    <Container header={{ title: 'Reschedule' }}>
      <div className="flex flex-col gap-3 text-sm">
      <div>
        <Button variant="secondary" loading={suggest.isPending} onClick={() => suggest.mutate()}>
          Suggest a new slot
        </Button>
      </div>
      {suggest.isError && <Alert type="error">{apiErrorText(suggest.error)}</Alert>}
      {suggest.data?.items.map((item) => (
        <div key={item.equipmentId} className="flex flex-col gap-1">
          <p className="text-text">
            {nameOf(item.equipmentId)}:{' '}
            {item.sameUnit
              ? `${formatDateTime(item.sameUnit.start)} - ${formatDateTime(item.sameUnit.end)}`
              : 'no free window within 60 days'}
          </p>
          <p className="text-text-muted">
            {item.alternatives.length
              ? `${item.alternatives.length} other free ${item.alternatives.length === 1 ? 'unit' : 'units'} of this type`
              : 'No other free unit of this type'}
          </p>
        </div>
      ))}
      </div>
    </Container>
  );
}

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
    <Container header={{ title: 'Phone confirmation' }}>
      <div className="flex flex-col gap-3">
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
      </div>
    </Container>
  );
}

function HoldCard({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const extend = useMutation({
    mutationFn: () => apiPatch<{ holdExpiresAt: string }>(`/bookings/${booking.id}/hold`, {}),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Hold extended', `The dates stay held until ${formatDateTime(data.holdExpiresAt)}.`);
    },
    onError: (e) => toast.error('Hold not extended', apiErrorText(e)),
  });
  if (booking.status !== 'pending' || !booking.holdExpiresAt) return null;
  const lapsed = new Date(booking.holdExpiresAt) <= new Date();
  return (
    <Container header={{ title: 'Date hold' }}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          {lapsed
            ? `The hold lapsed ${formatDateTime(booking.holdExpiresAt)}: other customers can book these dates. It is cancelled within the hour unless extended or paid.`
            : `Unpaid, so the dates are held until ${formatDateTime(booking.holdExpiresAt)}. Paying locks them.`}
        </p>
        <Button variant="secondary" loading={extend.isPending} onClick={() => extend.mutate()}>
          Extend hold
        </Button>
      </div>
    </Container>
  );
}

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
    <Container header={{ title: 'Delivery' }}>
      <div className="flex flex-col gap-3">
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
      </div>
    </Container>
  );
}

export function SiteRepContact({ name, mobile }: { name: string | null; mobile?: string | null | undefined }) {
  return (
    <>
      {name}
      {mobile && (
        <>
          {name ? ' · ' : ''}
          <a href={`tel:${mobile}`} className="underline">
            +63 {localPhMobile(mobile)}
          </a>
        </>
      )}
    </>
  );
}

export function BookingSide({ booking }: { booking: BookingDetailResponse }) {
  const quote = booking.quotation;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CallCard booking={booking} />
      <HoldCard booking={booking} />
      <Container header={{ title: 'Quote' }}>
        <div className="flex flex-col gap-3">
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
        {booking.status !== 'cancelled' && (!quote || quote.inNegotiation) && (
          <Link to="/app/quotes" search={{ bookingId: booking.id }} className={buttonClass('primary')}>{quote ? 'Revise quote' : 'Quote this booking'}</Link>
        )}
        {quote && (
          <Link to="/app/quotes/$quoteId/print" params={{ quoteId: quote.id }} className={buttonClass('secondary')}>Print quote</Link>
        )}
        </div>
      </Container>
      <Container header={{ title: 'Site' }}>
        <div className="flex flex-col gap-2 text-sm">
        <p className="text-text">{booking.siteCity ?? booking.siteProvince ?? '--'}</p>
        {(booking.siteContact || booking.siteContactMobile) && (
          <p className="text-text-muted">
            Contact: <SiteRepContact name={booking.siteContact} mobile={booking.siteContactMobile} />
          </p>
        )}
        {booking.siteNotes && <p className="text-text-muted">Access: {booking.siteNotes}</p>}
        <SiteProofAdmin siteId={booking.projectSiteId} />
        {booking.status === 'active' && <SiteEquipmentWeather siteId={booking.projectSiteId} />}
        {booking.items.map((item) => (
          <p key={`${item.equipmentId}-${String(item.start)}`} className="text-text-muted">
            {item.equipmentName ?? 'Machine'}: {formatDate(item.start)} - {formatDate(item.end)}
          </p>
        ))}
        </div>
      </Container>
      <DeliveryCard booking={booking} />
      {['active', 'completed'].includes(booking.status) && <EdtrSheetCard bookingId={booking.id} printable />}
      <PendingRequests booking={booking} />
      {booking.status === 'confirmed' && <RescheduleCard booking={booking} />}
    </div>
  );
}
