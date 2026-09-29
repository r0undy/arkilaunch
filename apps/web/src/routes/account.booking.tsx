import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { WeeklyBillingCard } from './statement.js';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, ClockIcon } from '../components/icons.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { MyEquipmentWeather } from '../components/equipment-weather.js';
import { apiErrorText, apiPatch, apiPost } from '../lib/api-client.js';
import { formatDate, formatDateTime, formatPeso, formatStatus, shortCode } from '../lib/format.js';

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

type BookingItem = BookingDetailResponse['items'][number];

// One machine on the booking, with ITS dates: each unit has its own window
// (and its own deliveries, returns and extensions), so no unit is shown
// under another's dates.
function MachineCard({ item, onSite }: { item: BookingItem; onSite: boolean }) {
  const { equipmentId } = item;
  const progress = onSite && item.status === 'active' ? leaseProgress(item.start, item.end) : null;

  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-muted">Machine on hire</h2>
        <span className="text-sm text-text-muted">{formatStatus(item.status)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-medium text-text-muted">Start</dt>
          <dd className="text-text">{formatDate(item.start)}</dd>
        </div>
        <div>
          <dt className="font-medium text-text-muted">Return</dt>
          <dd className="text-text">{item.end ? formatDate(item.end) : 'Open ended'}</dd>
        </div>
      </dl>
      {progress && (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-valuenow={progress.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Hire progress, ${item.equipmentName ?? 'machine'}`}
            className="h-2 w-full overflow-hidden rounded-sm bg-surface-sunk"
          >
            <div className="h-full bg-primary" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="text-sm text-text-muted">
            {progress.pct}% complete &middot; {progress.daysRemaining} day{progress.daysRemaining === 1 ? '' : 's'} remaining
          </p>
        </div>
      )}
      <p className="text-sm text-text-muted">{item.equipmentName ?? shortCode('equipment', equipmentId)}</p>
    </Surface>
  );
}

// The earliest start across the booking's machines.
export function earliestStart(items: { start: Date | string }[]): string | null {
  if (items.length === 0) return null;
  return new Date(Math.min(...items.map((item) => new Date(item.start).getTime()))).toISOString();
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
  // The booking's span: the first machine in, the last one back. Each
  // machine's own dates are on its card.
  const firstIn = earliestStart(booking.items);
  const lastOut = latestEnd(booking.items);
  const onSite = booking.status === 'active' || booking.status === 'completed';
  const returned = booking.status === 'completed';
  const paid =
    onSite || booking.status === 'confirmed' || booking.payments.some((payment) => payment.status === 'paid');
  const quoted = booking.quotation?.status === 'accepted';
  return [
    { label: 'Requested', done: true, detail: formatDate(booking.createdAt) },
    { label: 'Price agreed', done: quoted || paid, detail: booking.quotation ? formatPeso(booking.quotation.totalPhp) : null },
    { label: 'Paid', done: paid, detail: null },
    { label: 'Delivered', done: onSite, detail: firstIn ? formatDate(firstIn) : null },
    { label: 'Returned', done: returned, detail: lastOut ? formatDate(lastOut) : null },
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
            <span className="block text-sm font-medium text-text">
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

// What a customer can see grows with the booking: before payment only the
// request and its quote; once paid, invoices, payments and the deposit;
// once the machine is on site, hire progress and the deposit being used.
export function bookingStage(booking: BookingDetailResponse) {
  const onSite = booking.status === 'active' || booking.status === 'completed';
  const paid = onSite || booking.status === 'confirmed' || booking.payments.some((payment) => payment.status === 'paid');
  return { paid, onSite, cancelled: booking.status === 'cancelled' };
}

function DepositCard({ booking }: { booking: BookingDetailResponse }) {
  const { required, totalDeducted, deductions } = booking.deposit;
  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
      <h2 className="text-sm font-medium text-text-muted">Deposit</h2>
      {required === null ? (
        <p className="text-sm text-text-muted">No deposit is held against this booking yet.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-muted">Prepaid</span>
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
            <span className="font-semibold text-text">Balance left</span>
            <span className="font-mono font-semibold text-text">{formatPeso(Math.max(0, required - totalDeducted))}</span>
          </div>
          <p className="text-xs text-text-muted">
            Your deposit is prepaid hire, used up by verified field-log hours (each with its own invoice). You
            are warned when it runs low, so you can top up or extend.
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
      <h2 className="text-sm font-medium text-text-muted">Your requests</h2>
      {booking.changeRequests.map((request) => (
        <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-text">
            {request.kind === 'extend'
              ? `Extend ${booking.items.find((item) => item.id === request.assignmentId)?.equipmentName ?? 'all machines'} to ${formatDate(request.requestedEnd)}`
              : 'Cancel booking'}
          </span>
          <span className="text-text-muted">{formatStatus(request.status)}</span>
        </div>
      ))}
    </Surface>
  );
}

function BookingDetail({ booking }: { booking: BookingDetailResponse }) {
  const { paid, onSite } = bookingStage(booking);
  const firstIn = earliestStart(booking.items);
  const lastOut = latestEnd(booking.items);
  const several = booking.items.length > 1;
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
          <MachineCard key={item.id} item={item} onSite={onSite} />
        ))}

        {/* A booking with no equipment lines is a real state in this data --
            the seeded active booking has none -- and the page used to fall
            through to the timeline's "no return date" copy, which told the
            customer the wrong thing about a booking that has no machine on
            it at all. Say which it is. */}
        {booking.items.length === 0 && (
          <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-2 p-5">
            <h2 className="text-sm font-medium text-text-muted">
              Machine on hire
            </h2>
            <p className="text-sm text-text-muted">
              No equipment is recorded against this booking yet. The charges below still apply to
              it; ask the yard if you expected a machine to be listed here.
            </p>
          </Surface>
        )}

        {booking.items.length > 0 && (
          <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
            <h2 className="text-sm font-medium text-text-muted">
              {onSite ? 'Hire period' : paid ? 'Scheduled dates' : 'Requested dates'}
            </h2>
            {several && (
              <p className="text-sm text-text-muted">
                Each machine keeps its own dates, shown on its card. This is the whole booking, first machine in to
                last one back.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-text-muted">{several ? 'First start' : 'Start date'}</p>
                <p className="text-text">{firstIn ? formatDate(firstIn) : '--'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-text-muted">{several ? 'Last return' : 'Return date'}</p>
                <p className="text-text">{lastOut ? formatDate(lastOut) : 'Open ended'}</p>
              </div>
            </div>
          </Surface>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
      {!paid ? (
        <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
          <h2 className="text-sm font-medium text-text-muted">Price</h2>
          {booking.quotation?.totalPhp != null ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-muted">Quoted ({formatStatus(booking.quotation.status)})</span>
              <span className="font-mono text-text">{formatPeso(booking.quotation.totalPhp)}</span>
            </div>
          ) : (
            <p className="text-sm text-text-muted">The rental team is preparing your quote. Invoices and your deposit show here once you pay.</p>
          )}
          {/* QA 25: an unpaid request holds its dates for a limited time. */}
          {booking.status === 'pending' && booking.holdExpiresAt && (
            <p className="rounded-md border border-border bg-surface-sunk px-3 py-2 text-sm text-text">
              {new Date(booking.holdExpiresAt) > new Date()
                ? `Your dates are held until ${formatDateTime(booking.holdExpiresAt)}. Accept the quote and pay before then to lock them; after that they may go to another customer.`
                : 'The hold on your dates lapsed. You can still pay while they are free; contact the rental team if you need more time.'}
            </p>
          )}
        </Surface>
      ) : (
      <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
        <h2 className="text-sm font-medium text-text-muted">
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
          <span className="text-sm font-medium text-text">
            Invoiced
          </span>
          <span className="font-mono text-heading-md text-text">
            {formatPeso(invoiceTotal)}
          </span>
        </div>
        {/* The frame's "excl. VAT (20%)" line is not reproduced: nothing in
            the API states a tax rate, and 20% is not the Philippine rate the
            rest of this product is priced in. */}
      </Surface>
      )}
      {paid && <DepositCard booking={booking} />}
      {paid && <WeeklyBillingCard rentalId={booking.id} scope="me" />}
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

// The customer's daily logs: approved days only, never a pending one
// (cr-arkilaunch-edtr-site-hub-approval.md). Billable = running + idle;
// breakdown and weather are shown so the customer sees they were not billed.
export function FieldLogTable({ booking }: { booking: BookingDetailResponse }) {
  const logs = booking.fieldLogs;
  if (!logs || logs.days.length === 0) return null;
  const h = (n: number) => n.toFixed(1);
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <h2 className="text-sm font-medium text-text-muted">Daily logs</h2>
      <p className="text-sm text-text">
        Billed <span className="font-mono font-semibold">{h(logs.billable)} h</span> (running {h(logs.running)} h + idle{' '}
        {h(logs.idle)} h). Not billed: breakdown {h(logs.breakdown)} h, weather {h(logs.weather)} h
        {logs.otherDowntime > 0 ? `, other ${h(logs.otherDowntime)} h` : ''}.
      </p>
      {logs.downtimeDays > 0 && (
        <p className="text-sm text-text-muted">
          {logs.downtimeDays} full day{logs.downtimeDays === 1 ? ' was' : 's were'} lost to downtime. You can ask to
          extend your rental by those days.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Approved daily logs</caption>
          <thead>
            <tr className="text-left text-text-muted">
              <th className="p-2">Day</th>
              <th className="p-2">Machine</th>
              <th className="p-2 text-right">Running</th>
              <th className="p-2 text-right">Idle</th>
              <th className="p-2 text-right">Downtime</th>
              <th className="p-2 text-right">Billed</th>
            </tr>
          </thead>
          <tbody>
            {logs.days.map((d) => (
              <tr key={`${d.date}-${d.equipmentName}`} className="border-t border-border">
                <td className="p-2">{formatDate(d.date)}</td>
                <td className="p-2">{d.equipmentName}</td>
                <td className="p-2 text-right font-mono">{h(d.hours.running)}</td>
                <td className="p-2 text-right font-mono">{h(d.hours.idle)}</td>
                <td className="p-2 text-right font-mono">{h(d.hours.breakdown + d.hours.weather + d.hours.otherDowntime)}</td>
                <td className="p-2 text-right font-mono font-semibold">{h(d.hours.billable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function BookingDetailPage() {
  const { bookingId } = accountBookingRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  const status = booking.data?.status ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={booking.data?.code ?? 'Booking'}
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
            {booking.data && bookingStage(booking.data).paid && !bookingStage(booking.data).cancelled && (
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
      {booking.data && <FieldLogTable booking={booking.data} />}
      {booking.data && (status === 'active' || status === 'confirmed') && <MyEquipmentWeather siteId={booking.data.projectSiteId} />}
    </div>
  );
}

// The latest return date across a booking's machines; null when any unit is
// open-ended (no fixed date to extend from).
export function latestEnd(items: { end: Date | string | null }[]): string | null {
  let latest: number | null = null;
  for (const item of items) {
    if (item.end === null) return null;
    const t = new Date(item.end).getTime();
    if (latest === null || t > latest) latest = t;
  }
  return latest === null ? null : new Date(latest).toISOString();
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
  // One machine at a time: each keeps its own return date, so extending one
  // never drags the others along.
  const units = (booking.data?.items ?? []).filter((item) => item.status !== 'cancelled' && item.status !== 'completed');
  const [chosen, setChosen] = useState('');
  const unit = units.find((item) => item.id === chosen) ?? (units.length === 1 ? units[0] : undefined);
  const currentEnd = unit?.end ? new Date(unit.end).toISOString() : null;

  const request = useMutation({
    mutationFn: () =>
      apiPost(`/bookings/${bookingId}/change-requests`, {
        kind: 'extend',
        assignmentId: unit?.id,
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
          <h1 className="text-display-md text-text">Extension requested</h1>
          <p className="text-sm text-text-muted">
            The rental team checks {unit?.equipmentName ?? 'the machine'} is free until{' '}
            {formatDate(`${end}T17:00:00`)} and confirms. Your other machines keep their dates. You get a notification either way; any extra charge is quoted before you pay it.
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
      <PageHeader title="Extend rental" {...(booking.data ? { description: `Booking ${booking.data.code}` } : {})} />
      <Surface radius="md" elevation="sm" className="flex max-w-xl flex-col gap-4 p-6">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {units.length > 1 && (
            <Select
              label="Machine to extend"
              id="extend-unit"
              required
              value={unit?.id ?? ''}
              onChange={(e) => {
                setChosen(e.target.value);
                setEnd('');
              }}
            >
              <option value="" disabled>
                Select...
              </option>
              {units.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.equipmentName ?? 'Machine'} (due back {item.end ? formatDate(item.end) : 'open'})
                </option>
              ))}
            </Select>
          )}
          {unit && (
            <p className="text-sm text-text-muted">
              {units.length === 1 && unit.equipmentName ? `${unit.equipmentName}: currently` : 'Currently'} due back{' '}
              {currentEnd ? formatDate(currentEnd) : 'on an open date'}.
            </p>
          )}
          <Input label="New return date" type="date" required min={minDate} value={end} onChange={(e) => setEnd(e.target.value)} />
          <Input label="Reason (optional)" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={request.isPending} disabled={!end || !unit}>
              Request extension
            </Button>
            <Link to="/account/bookings/$bookingId" params={{ bookingId }}>
              <Button variant="ghost">Cancel</Button>
            </Link>
          </div>
          {request.isError && <p role="alert" className="text-sm text-error">{apiErrorText(request.error)}</p>}
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
