import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingDetailResponse, BookingService, TruckRequestResponse } from '@arkilaunch/shared';
import { bookingsQueries, trucksQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { formatDate, formatDateTime, formatInvoiceType, formatPeso, formatStatus } from '../lib/format.js';
import { Alert } from './alert.js';
import { RequestRow } from '../routes/app.trucks.js';
import { Button } from './button.js';
import { Modal } from './modal.js';
import { Tabs } from './tabs.js';
import { StatusBadge } from './status-badge.js';
import { RouteMap } from './route-map.js';
import { TruckThread } from './truck-thread.js';
import { NegotiationThread } from './negotiation-thread.js';
import { BookingSide } from './booking-actions.js';

// One drawer for both services (cr-arkilaunch-uniform-booking-codes.md):
// the admin reads and works a booking start to end without leaving the
// list -- overview, negotiation thread and every action, in tabs. The full
// page (/app/bookings/$bookingId) shows the same pieces for a deep link.

const heading = 'text-heading-md text-text';

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
          <span className={step.done ?'font-semibold text-text' : 'text-text-muted'}>
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
              <span className={invoice.status ==='paid' ? 'text-success' : 'text-text-muted'}>
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

type DrawerTab = 'overview' | 'negotiation' | 'actions';
const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'actions', label: 'Actions' },
];

// A truck trip at a glance: the route map (when the customer pinned both
// ends), the schedule and the money.
function TruckOverview({ truck }: { truck: TruckRequestResponse }) {
  const pickup = useMemo(
    () => (truck.pickupLat !== null && truck.pickupLng !== null ? { lat: truck.pickupLat, lng: truck.pickupLng } : null),
    [truck.pickupLat, truck.pickupLng],
  );
  const dropoff = useMemo(
    () => (truck.dropoffLat !== null && truck.dropoffLng !== null ? { lat: truck.dropoffLat, lng: truck.dropoffLng } : null),
    [truck.dropoffLat, truck.dropoffLng],
  );
  const route = useQuery({ ...trucksQueries.route(truck.id), enabled: !!pickup && !!dropoff });
  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={truckSteps(truck)} cancelled={truck.status === 'cancelled'} />
      <Section title="Route">
        <p className="text-sm font-medium text-text">
          {truck.pickup} → {truck.dropoff}
        </p>
        {pickup && dropoff ? (
          <>
            <RouteMap pickup={pickup} dropoff={dropoff} route={route.data ?? null} className="h-72" />
            {route.isError && (
              <p className="text-xs text-text-muted">The road route is unavailable; the pins are joined in a straight line.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted">
            No exact pins on this request; the estimate routed between the place names.
          </p>
        )}
      </Section>
      <Section title="Trip">
        <dl className="flex flex-col gap-1">
          <Row label="Pickup">{formatDateTime(truck.scheduledFor)}</Row>
          <Row label="Distance">
            <span className="font-mono tabular-nums">
              {truck.confirmedKm !== null ? `${truck.confirmedKm} km confirmed` : `~${truck.estimatedKm} km estimated`}
            </span>
          </Row>
          <Row label="Crew">{[truck.driverName, truck.helperName].filter(Boolean).join(', ') || '--'}</Row>
        </dl>
        {truck.notes && <p className="whitespace-pre-line text-sm text-text-muted">{truck.notes}</p>}
      </Section>
      <Section title="Money">
        <dl className="flex flex-col gap-1">
          <Row label={truck.confirmedKm !== null ? 'Price' : 'Estimate'}>
            <span className="font-mono tabular-nums">{formatPeso(truck.price.totalPhp)}</span>
          </Row>
          <Row label="Agreed">
            <span className="font-mono tabular-nums">{truck.agreedPricePhp !== null ? formatPeso(truck.agreedPricePhp) : '--'}</span>
          </Row>
          <Row label="Customer cap">
            <span className="font-mono tabular-nums">{truck.capPhp !== null ? formatPeso(truck.capPhp) : '--'}</span>
          </Row>
        </dl>
      </Section>
    </div>
  );
}

export function BookingDrawer({
  target,
  truck,
  onClose,
}: {
  target: BookingDrawerTarget | null;
  // The staff page looks the truck request up by its code.
  truck: TruckRequestResponse | undefined;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>('overview');
  // A different booking opens on its overview.
  useEffect(() => setTab('overview'), [target?.id]);
  const rentalId = target?.service === 'rental' ? target.id : null;
  const booking = useQuery({ ...bookingsQueries.detail(rentalId ?? ''), enabled: !!rentalId });
  const shownTruck = target?.service === 'truck' && truck?.id === target.id ? truck : undefined;
  const code = rentalId ? booking.data?.code : shownTruck?.code;
  const status = rentalId ? booking.data?.status : shownTruck?.status;

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
            <Button variant="ghost">Open as a full page</Button>
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {status && (
          <div>
            <StatusBadge status={status} />
          </div>
        )}
        <Tabs label="Booking sections" items={TABS} value={tab} onChange={setTab} />
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {rentalId && booking.isError && <Alert type="error">{apiErrorText(booking.error)}</Alert>}
          {rentalId && booking.isPending && <p className="text-sm text-text-muted">Loading booking...</p>}
          {booking.data && rentalId && (
            <>
              {tab === 'overview' && <RentalBody booking={booking.data} />}
              {tab === 'negotiation' && (
                <NegotiationThread bookingId={rentalId} disabled={booking.data.status === 'cancelled'} />
              )}
              {tab === 'actions' && <BookingSide booking={booking.data} />}
            </>
          )}
          {shownTruck && (
            <>
              {tab === 'overview' && <TruckOverview truck={shownTruck} />}
              {tab === 'negotiation' && <TruckThread base={`/truck-requests/${shownTruck.id}`} />}
              {tab === 'actions' && <RequestRow r={shownTruck} />}
            </>
          )}
          {target?.service === 'truck' && !shownTruck && (
            <p className="text-sm text-text-muted">Loading truck request...</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
