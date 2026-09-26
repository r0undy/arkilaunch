import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { BookingDetailResponse, BookingService, TruckRequestResponse } from '@arkilaunch/shared';
import { bookingsQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { formatDate, formatInvoiceType, formatPeso, formatStatus } from '../lib/format.js';
import { RequestRow } from '../routes/app.trucks.js';
import { BookingCode } from './booking-code.js';
import { Button } from './button.js';
import { Modal } from './modal.js';

// One drawer for both services (cr-arkilaunch-uniform-booking-codes.md):
// the admin reads a booking start to end without leaving the list. The full
// page (/app/bookings/$bookingId) keeps the negotiation thread and the
// actions that need room.

const heading = 'font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted';

export interface Step {
  label: string;
  done: boolean;
}

// request → call → quote → paid → deployed → returned. Derived, not
// stored: each step is a fact already on the booking.
export function rentalSteps(b: Pick<BookingDetailResponse, 'status' | 'callConfirmedAt' | 'quotation'>): Step[] {
  const paid = ['confirmed', 'active', 'completed'].includes(b.status);
  return [
    { label: 'Requested', done: true },
    { label: 'Call confirmed', done: !!b.callConfirmedAt },
    { label: 'Quote accepted', done: b.quotation?.status === 'accepted' || paid },
    { label: 'Paid', done: paid },
    { label: 'Deployed', done: ['active', 'completed'].includes(b.status) },
    { label: 'Returned', done: b.status === 'completed' },
  ];
}

// estimated → km confirmed → agreed → paid.
export function truckSteps(t: Pick<TruckRequestResponse, 'status'>): Step[] {
  const order = ['estimated', 'km_confirmed', 'agreed', 'paid'];
  const at = order.indexOf(t.status);
  return ['Estimated', 'Km confirmed', 'Agreed', 'Paid'].map((label, i) => ({ label, done: at >= i }));
}

function Stepper({ steps, cancelled }: { steps: Step[]; cancelled: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="h-px w-3 bg-border" />}
          <span className={step.done ? 'font-semibold text-text' : 'text-text-muted'}>
            <span aria-hidden>{step.done ? '● ' : '○ '}</span>
            {step.label}
            <span className="sr-only">{step.done ? ' (done)' : ' (not yet)'}</span>
          </span>
        </li>
      ))}
      {cancelled && <li className="font-semibold text-error">Cancelled</li>}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className={heading}>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 text-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text">{children}</dd>
    </div>
  );
}

function RentalBody({ booking }: { booking: BookingDetailResponse }) {
  const extensions = booking.changeRequests.filter((request) => request.kind === 'extend');
  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={rentalSteps(booking)} cancelled={booking.status === 'cancelled'} />
      <Section title="Customer">
        <dl className="flex flex-col gap-1">
          <Row label="Company">{booking.customerName ?? '--'}</Row>
          <Row label="Site rep">{booking.siteContact ?? '--'}</Row>
        </dl>
      </Section>
      <Section title="Schedule and machines">
        <ul className="flex flex-col gap-1 text-sm">
          {booking.items.map((item) => (
            <li key={`${item.equipmentId}-${String(item.start)}`} className="flex flex-wrap justify-between gap-x-4">
              <span className="text-text">{item.equipmentName ?? 'Machine'}</span>
              <span className="text-text-muted">
                {formatDate(item.start)} – {item.end ? formatDate(item.end) : 'open'}
              </span>
            </li>
          ))}
          {booking.items.length === 0 && <li className="text-text-muted">No machines assigned.</li>}
        </ul>
        {extensions.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-text-muted">
            {extensions.map((request) => (
              <li key={request.id}>
                Extension to {formatDate(request.requestedEnd)} · {formatStatus(request.status)}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Site">
        <p className="text-sm text-text">{booking.siteCity ?? booking.siteProvince ?? '--'}</p>
        {booking.siteNotes && <p className="text-sm text-text-muted">Access: {booking.siteNotes}</p>}
        <Link
          to="/app/deployment/$siteId"
          params={{ siteId: booking.projectSiteId }}
          className="text-sm text-accent underline"
        >
          Open site hub
        </Link>
      </Section>
      {booking.fieldLogs && (
        <Section title="Field logs (approved)">
          <dl className="flex flex-col gap-1">
            <Row label="Running">{booking.fieldLogs.running.toFixed(1)} h</Row>
            <Row label="Billable idle">{booking.fieldLogs.idle.toFixed(1)} h</Row>
            <Row label="Breakdown">{booking.fieldLogs.breakdown.toFixed(1)} h</Row>
            <Row label="Weather">{booking.fieldLogs.weather.toFixed(1)} h</Row>
            <Row label="Days logged">
              {booking.fieldLogs.daysApproved} of {booking.fieldLogs.daysInSpan}
            </Row>
          </dl>
          {booking.fieldLogs.pending > 0 && (
            <p className="text-sm font-semibold text-warning">
              {booking.fieldLogs.pending} day{booking.fieldLogs.pending === 1 ? '' : 's'} waiting for approval
            </p>
          )}
        </Section>
      )}
      <Section title="Money">
        <dl className="flex flex-col gap-1">
          <Row label="Quote">
            {booking.quotation?.totalPhp != null
              ? `${formatPeso(booking.quotation.totalPhp)} · ${formatStatus(booking.quotation.status)}`
              : 'Not quoted'}
          </Row>
          <Row label="Deposit">
            {booking.deposit.required != null
              ? `${formatPeso(Math.max(0, booking.deposit.required - booking.deposit.totalDeducted))} left of ${formatPeso(booking.deposit.required)}`
              : '--'}
          </Row>
        </dl>
        <ul className="flex flex-col gap-1 text-sm">
          {booking.invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap justify-between gap-x-4">
              <span className="text-text">{formatInvoiceType(invoice.invoiceType)}</span>
              <span className={invoice.status === 'paid' ? 'text-success' : 'text-text-muted'}>
                {formatPeso(invoice.amount)} · {formatStatus(invoice.status)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export interface BookingDrawerTarget {
  service: BookingService;
  id: string;
}

export function BookingDrawer({
  target,
  trucks,
  onClose,
}: {
  target: BookingDrawerTarget | null;
  trucks: TruckRequestResponse[];
  onClose: () => void;
}) {
  const rentalId = target?.service === 'rental' ? target.id : null;
  const booking = useQuery({ ...bookingsQueries.detail(rentalId ?? ''), enabled: !!rentalId });
  const truck = target?.service === 'truck' ? trucks.find((t) => t.id === target.id) : undefined;
  const code = rentalId ? booking.data?.code : truck?.code;

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      placement="right"
      size="lg"
      title={code ?? 'Booking'}
      description={target?.service === 'truck' ? 'Truck service' : 'Equipment rental'}
      footer={
        rentalId ? (
          <Link to="/app/bookings/$bookingId" params={{ bookingId: rentalId }}>
            <Button variant="secondary">Open negotiation and actions</Button>
          </Link>
        ) : undefined
      }
    >
      {rentalId && booking.isError && <p className="text-sm text-error">{apiErrorText(booking.error)}</p>}
      {rentalId && booking.isPending && <p className="text-sm text-text-muted">Loading booking...</p>}
      {booking.data && rentalId && <RentalBody booking={booking.data} />}
      {truck && (
        <div className="flex flex-col gap-4">
          <BookingCode code={truck.code} service="truck" />
          <Stepper steps={truckSteps(truck)} cancelled={truck.status === 'cancelled'} />
          <RequestRow r={truck} />
        </div>
      )}
      {target?.service === 'truck' && !truck && <p className="text-sm text-text-muted">Truck request not found.</p>}
    </Modal>
  );
}
