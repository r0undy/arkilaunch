import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries, equipmentQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, ClockIcon } from '../components/icons.js';
import { Input } from '../components/input.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { apiErrorText, apiPatch, apiPost } from '../lib/api-client.js';
import { formatDate, formatPeso, formatStatus, shortCode } from '../lib/format.js';

const STATUS_TONES: Record<string, StatusTone> = {
  confirmed: 'recon-approved',
  active: 'recon-approved',
  completed: 'recon-approved',
  pending: 'recon-review',
  cancelled: 'recon-failed',
};

/**
 * How far through the hire we are, as a percentage.
 *
 * Returns null rather than a number whenever the window cannot be measured
 * -- no end date, an unparseable date, or a zero-length window -- so the
 * caller shows nothing instead of a confident "0% complete" on a booking
 * whose dates simply are not known yet.
 */
export function leaseProgress(
  start: Date | string,
  end: Date | string | null,
  now: Date = new Date(),
): { pct: number; daysRemaining: number } | null {
  if (!end) return null;
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;

  const elapsed = now.getTime() - from;
  const pct = Math.min(100, Math.max(0, Math.round((elapsed / (to - from)) * 100)));
  const daysRemaining = Math.max(0, Math.ceil((to - now.getTime()) / 86_400_000));
  return { pct, daysRemaining };
}

function MachineCard({ equipmentId }: { equipmentId: string }) {
  const fleet = useQuery(equipmentQueries.list());
  const match = fleet.data?.items.find((item) => item.id === equipmentId);

  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
        Machine on hire
      </h2>
      {match ? (
        <>
          <p className="font-display text-xl font-semibold text-text">{match.model}</p>
          <p className="font-mono text-sm text-text-muted">
            Serial {match.serialNo} &middot; {shortCode('equipment', equipmentId)}
          </p>
          {/* The frame prints horsepower, operating weight and fuel system
              beside the machine. EquipmentSummaryResponse carries model,
              serial, status and runtime hours -- no spec sheet -- so the
              strip shows what the fleet record actually knows. */}
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <dt className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                Status
              </dt>
              <dd className="text-text">{formatStatus(match.availabilityStatus)}</dd>
            </div>
            <div>
              <dt className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                Runtime hours
              </dt>
              <dd className="font-mono text-text">{match.runtimeHours}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="font-mono text-sm text-text-muted">{shortCode('equipment', equipmentId)}</p>
      )}
    </Surface>
  );
}

export interface TimelineStep {
  label: string;
  done: boolean;
  detail: string | null;
}

/**
 * Where the booking is in the journey, derived from the records that prove
 * each step: an accepted quote, a paid payment, and the booking status staff
 * move on site (`active` once delivered, `completed` once returned).
 */
export function bookingTimeline(booking: BookingDetailResponse): TimelineStep[] {
  const first = booking.items[0];
  const onSite = booking.status === 'active' || booking.status === 'completed';
  const returned = booking.status === 'completed';
  const paid =
    onSite || booking.status === 'confirmed' || booking.payments.some((payment) => payment.status === 'paid');
  const quoted = booking.quotation?.status === 'accepted';
  return [
    { label: 'Requested', done: true, detail: formatDate(booking.createdAt) },
    { label: 'Price agreed', done: quoted || paid, detail: booking.quotation ? formatPeso(booking.quotation.totalPhp) : null },
    { label: 'Paid', done: paid, detail: null },
    { label: 'Delivered', done: onSite, detail: first ? formatDate(first.start) : null },
    { label: 'Returned', done: returned, detail: first?.end ? formatDate(first.end) : null },
  ];
}

function Timeline({ booking }: { booking: BookingDetailResponse }) {
  if (booking.status === 'cancelled') {
    return (
      <p className="rounded-md border border-error px-3 py-2 text-sm text-error">
        This booking is cancelled. Any refund due is handled by the billing team.
      </p>
    );
  }
  return (
    <ol className="grid gap-2 sm:grid-cols-5">
      {bookingTimeline(booking).map((step) => (
        <li key={step.label} className="flex items-start gap-2 sm:flex-col">
          <span
            aria-hidden="true"
            className={[
              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
              step.done ? 'border-success bg-success text-white' : 'border-border bg-surface text-text-muted',
            ].join(' ')}
          >
            {step.done ? <CheckIcon /> : null}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-xs font-semibold uppercase tracking-[0.04em] text-text">
              {step.label}
              <span className="sr-only">{step.done ? ' (done)' : ' (not yet)'}</span>
            </span>
            {step.detail && <span className="block text-xs text-text-muted">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function NextStep({ booking }: { booking: BookingDetailResponse }) {
  const quote = booking.quotation;
  const paid = booking.status === 'confirmed' || booking.payments.some((payment) => payment.status === 'paid');
  if (booking.status === 'cancelled' || paid) return null;
  const toNegotiation = (label: string) => (
    <Link to="/account/negotiation/$bookingId" params={{ bookingId: booking.id }}>
      <Button variant="primary">{label}</Button>
    </Link>
  );
  if (!quote) return toNegotiation('Talk to the rental team');
  if (quote.status === 'approved') return toNegotiation('Review your quote');
  if (quote.status === 'accepted') {
    return (
      <Link to="/account/checkout/$bookingId" params={{ bookingId: booking.id }}>
        <Button variant="primary">Pay now</Button>
      </Link>
    );
  }
  return toNegotiation('Open negotiation');
}

function DepositCard({ booking }: { booking: BookingDetailResponse }) {
  const { required, totalDeducted, deductions } = booking.deposit;
  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">Deposit</h2>
      {required === null ? (
        <p className="text-sm text-text-muted">No deposit is held against this booking yet.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-muted">Held</span>
            <span className="font-mono text-text">{formatPeso(required)}</span>
          </div>
          {deductions.map((deduction) => (
            <Link
              key={deduction.invoiceId}
              to="/account/invoices/$invoiceId"
              params={{ invoiceId: deduction.invoiceId }}
              className="flex items-center justify-between gap-3 text-sm underline"
            >
              <span className="text-text-muted">Deducted {formatDate(deduction.createdAt)}</span>
              <span className="font-mono text-text">- {formatPeso(deduction.amount)}</span>
            </Link>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
            <span className="font-semibold text-text">To be refunded</span>
            <span className="font-mono font-semibold text-text">{formatPeso(Math.max(0, required - totalDeducted))}</span>
          </div>
          <p className="text-xs text-text-muted">
            Deductions are only made from verified field logs, each with its own invoice showing why.
          </p>
        </>
      )}
    </Surface>
  );
}

function ChangeRequests({ booking }: { booking: BookingDetailResponse }) {
  if (booking.changeRequests.length === 0) return null;
  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-2 p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">Your requests</h2>
      {booking.changeRequests.map((request) => (
        <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-text">
            {request.kind === 'extend' ? `Extend to ${formatDate(request.requestedEnd)}` : 'Cancel booking'}
          </span>
          <span className="text-text-muted">{formatStatus(request.status)}</span>
        </div>
      ))}
    </Surface>
  );
}

function BookingDetail({ booking }: { booking: BookingDetailResponse }) {
  const first = booking.items[0];
  const progress = first ? leaseProgress(first.start, first.end) : null;
  const invoiceTotal = booking.invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const paidTotal = booking.payments
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,380px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-4 p-5">
          <Timeline booking={booking} />
          <NextStep booking={booking} />
        </Surface>
        {booking.items.map((item) => (
          <MachineCard key={`${item.equipmentId}-${String(item.start)}`} equipmentId={item.equipmentId} />
        ))}

        {/* A booking with no equipment lines is a real state in this data --
            the seeded active booking has none -- and the page used to fall
            through to the timeline's "no return date" copy, which told the
            customer the wrong thing about a booking that has no machine on
            it at all. Say which it is. */}
        {booking.items.length === 0 && (
          <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-2 p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
              Machine on hire
            </h2>
            <p className="text-sm text-text-muted">
              No equipment is recorded against this booking yet. The charges below still apply to
              it; ask the yard if you expected a machine to be listed here.
            </p>
          </Surface>
        )}

        <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
              Lease timeline
            </h2>
            {progress && (
              <p className="font-display text-sm font-semibold text-text">
                {progress.daysRemaining} day{progress.daysRemaining === 1 ? '' : 's'} remaining
              </p>
            )}
          </div>

          {progress ? (
            <>
              <div
                role="progressbar"
                aria-valuenow={progress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Lease progress"
                className="h-2 w-full overflow-hidden rounded-sm bg-surface-sunk"
              >
                <div className="h-full bg-primary" style={{ width: `${progress.pct}%` }} />
              </div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                {progress.pct}% complete
              </p>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              {booking.items.length === 0
                ? 'This booking has no equipment lines, so there is no hire period to track.'
                : 'No return date is set on this booking yet, so there is no progress to show.'}
            </p>
          )}

          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
            {first && (
              <>
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                    Start date
                  </p>
                  <p className="text-text">{formatDate(first.start)}</p>
                </div>
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                    Return date
                  </p>
                  <p className="text-text">{first.end ? formatDate(first.end) : 'Open ended'}</p>
                </div>
              </>
            )}
          </div>
        </Surface>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
      <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
          Financial ledger
        </h2>
        {booking.quotation && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-muted">Quoted ({formatStatus(booking.quotation.status)})</span>
            <span className="font-mono text-text">{formatPeso(booking.quotation.totalPhp ?? 0)}</span>
          </div>
        )}
        {booking.invoices.map((invoice) => (
          <Link
            key={invoice.id}
            to="/account/invoices/$invoiceId"
            params={{ invoiceId: invoice.id }}
            className="flex items-center justify-between gap-3 text-sm underline"
          >
            <span className="text-text-muted">
              {formatStatus(invoice.invoiceType)} &middot; {formatStatus(invoice.status)}
            </span>
            <span className="font-mono text-text">{formatPeso(invoice.amount)}</span>
          </Link>
        ))}
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-text-muted">Paid</span>
          <span className="font-mono text-text">{formatPeso(paidTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
            Invoiced
          </span>
          <span className="font-mono text-lg font-semibold text-text">
            {formatPeso(invoiceTotal)}
          </span>
        </div>
        {/* The frame's "excl. VAT (20%)" line is not reproduced: nothing in
            the API states a tax rate, and 20% is not the Philippine rate the
            rest of this product is priced in. */}
      </Surface>
      <DepositCard booking={booking} />
      <ChangeRequests booking={booking} />
      </div>
    </div>
  );
}

// Before paying, a customer cancels outright; after, it is a request the
// billing team resolves (they also issue any refund).
function CancelAction({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const unpaid = booking.status === 'pending';
  const hasOpenRequest = booking.changeRequests.some((request) => request.status === 'pending');

  const cancel = useMutation({
    mutationFn: () =>
      unpaid
        ? apiPatch(`/bookings/${booking.id}/cancel`, {})
        : apiPost(`/bookings/${booking.id}/change-requests`, { kind: 'cancel' }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      toast.success(unpaid ? 'Booking cancelled' : 'Cancellation requested', unpaid ? undefined : 'The billing team will confirm it and any refund.');
    },
    onError: (err) => toast.error('That did not go through', apiErrorText(err)),
  });

  if (booking.status === 'cancelled' || hasOpenRequest) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {unpaid ? 'Cancel booking' : 'Request cancellation'}
      </Button>
      <ConfirmDialog
        open={open}
        title={unpaid ? 'Cancel this booking?' : 'Ask to cancel this paid booking?'}
        body={
          unpaid
            ? 'The machines are released for those dates. Nothing has been charged.'
            : 'The billing team reviews the request and handles any refund through the payment provider.'
        }
        confirmLabel={unpaid ? 'Cancel booking' : 'Send request'}
        cancelLabel="Keep booking"
        tone="danger"
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function BookingDetailPage() {
  const { bookingId } = accountBookingRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  const status = booking.data?.status ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My bookings"
        title={shortCode('booking', bookingId)}
        description="Where this hire stands and what it has cost."
        actions={
          <>
            {status && (
              <StatusPill
                tone={STATUS_TONES[status] ?? 'recon-review'}
                label={formatStatus(status)}
                icon={status === 'confirmed' ? <CheckIcon /> : <ClockIcon />}
              />
            )}
            {booking.data && booking.data.status !== 'cancelled' && (
              <Link to="/account/bookings/$bookingId/extend" params={{ bookingId }}>
                <Button variant="secondary">Extend rental</Button>
              </Link>
            )}
            {booking.data && <CancelAction booking={booking.data} />}
          </>
        }
      />
      <DataPanel
        title="Booking"
        options={bookingsQueries.detail(bookingId)}
        emptyTitle="Booking not found"
        emptyDescription="This booking does not exist, or it belongs to another account."
        isEmpty={(data) => !data?.id}
        render={(data) => <BookingDetail booking={data} />}
      />
    </div>
  );
}

// Figma 231:5204 (Extend Rental) and 237:1855 (Extend Rental Submitted).
// The customer asks for a new return date; staff approve it after the
// server re-checks that no other booking has those days.
function ExtendRentalPage() {
  const { bookingId } = accountBookingExtendRoute.useParams();
  const navigate = useNavigate();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const currentEnd = booking.data?.items[0]?.end ?? null;

  const request = useMutation({
    mutationFn: () =>
      apiPost(`/bookings/${bookingId}/change-requests`, {
        kind: 'extend',
        requestedEnd: new Date(`${end}T17:00:00`).toISOString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => setSent(true),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    request.mutate();
  }

  if (sent) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <Surface radius="md" elevation="sm" className="flex flex-col items-start gap-4 p-6">
          <StatusPill tone="recon-review" label="Submitted" icon={<ClockIcon />} />
          <h1 className="font-display text-2xl font-semibold text-text">Extension requested</h1>
          <p className="text-sm text-text-muted">
            The rental team checks the machines are free until {formatDate(`${end}T17:00:00`)} and
            confirms. You get a notification either way; any extra charge is quoted before you pay it.
          </p>
          <Button variant="primary" onClick={() => navigate({ to: '/account/bookings/$bookingId', params: { bookingId } })}>
            Back to booking
          </Button>
        </Surface>
      </div>
    );
  }

  const minDate = currentEnd ? new Date(new Date(currentEnd).getTime() + 86_400_000).toISOString().slice(0, 10) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="My bookings" title="Extend rental" description={`Booking ${shortCode('booking', bookingId)}`} />
      <Surface radius="md" elevation="sm" className="flex max-w-xl flex-col gap-4 p-6">
        <p className="text-sm text-text-muted">
          Currently due back {currentEnd ? formatDate(currentEnd) : 'on an open date'}.
        </p>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Input label="New return date" type="date" required min={minDate} value={end} onChange={(e) => setEnd(e.target.value)} />
          <Input label="Reason (optional)" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={request.isPending} disabled={!end}>
              Request extension
            </Button>
            <Link to="/account/bookings/$bookingId" params={{ bookingId }}>
              <Button variant="ghost">Cancel</Button>
            </Link>
          </div>
          {request.isError && <p className="text-sm text-error">{apiErrorText(request.error)}</p>}
        </form>
      </Surface>
    </div>
  );
}

export const accountBookingRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings/$bookingId',
  component: BookingDetailPage,
});

export const accountBookingExtendRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings/$bookingId/extend',
  component: ExtendRentalPage,
});
