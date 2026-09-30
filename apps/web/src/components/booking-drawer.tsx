import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingDetailResponse, BookingService, TruckRequestResponse } from '@arkilaunch/shared';
import { tripSteps, type TripStep } from './truck-trip.js';
import { banHits } from '@arkilaunch/shared';
import { bookingsQueries, truckBanRulesQuery, trucksQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { formatDate, formatDateTime, formatInvoiceType, formatPeso, formatStatus, WEEKDAYS } from '../lib/format.js';
import { Alert } from './alert.js';
import { RequestRow } from '../routes/app.trucks.js';
import { buttonClass } from './button.js';
import { Modal } from './modal.js';
import { Tabs } from './tabs.js';
import { StatusBadge } from './status-badge.js';
import { RouteMap } from './route-map.js';
import { NegotiationThread } from './negotiation-thread.js';
import { BookingSide, SiteRepContact } from './booking-actions.js';
import { MessengerLinks } from './messenger-links.js';

const heading = 'text-heading-md text-text';

export function rentalSteps(b: Pick<BookingDetailResponse, 'status' | 'callConfirmedAt' | 'quotation'>): TripStep[] {
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

function Stepper({ steps, cancelled }: { steps: TripStep[]; cancelled: boolean }) {
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
          <Row label="Site rep">
            <SiteRepContact name={booking.siteContact ?? '--'} mobile={booking.siteContactMobile} />
          </Row>
        </dl>
      </Section>
      <Section title="Schedule and machines">
        <ul className="flex flex-col gap-1 text-sm">
          {booking.items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-x-4">
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
                Extend {booking.items.find((item) => item.id === request.assignmentId)?.equipmentName ?? 'all machines'} to {formatDate(request.requestedEnd)} · {formatStatus(request.status)}
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
  const rules = useQuery(truckBanRulesQuery);
  const cities = route.data?.cities ?? truck.routeCities ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={tripSteps(truck)} cancelled={truck.status === 'cancelled'} />
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
            {cities.length ? (
              <div className="text-xs text-text-muted">
                <p>Route passes through:</p>
                <ol className="mt-1 flex flex-wrap items-center gap-1">
                  {cities.map((place, index) => (
                    <li key={`${place.city}-${place.province}-${index}`} className="rounded border border-border px-2 py-1">
                      {place.city}{place.province ? `, ${place.province}` : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {cities.map((place, index) => {
              const match = rules.data?.filter((rule) => rule.city.toLowerCase().replace(/ city$/, '') === place.city.toLowerCase().replace(/ city$/, '')) ?? [];
              return match.map((rule) => {
                const hit = banHits([place], [rule], new Date(truck.scheduledFor)).length > 0;
                return <p key={`${rule.id}-${index}`} className="text-xs text-text-muted">
                  <strong>{place.city}</strong> - trucks banned {rule.windows.map((w) => `${w.from}-${w.to}`).join(' & ')},
                  {' '}{rule.days.map((day) => WEEKDAYS[day]).join(', ')}
                  {hit ? ' | pickup falls inside: permit or reschedule' : ' | pickup outside listed hours'}
                  {rule.minGvwKg !== null && ` | applies from ${rule.minGvwKg} kg GVW (vehicle weight not recorded)`}
                  {!rule.verified && ' | rule not verified'}
                  {rule.permitNote && ` | ${rule.permitNote}`}
                </p>;
              });
            })}
          </>
        ) : (
          <p className="text-sm text-text-muted">
            No exact pins on this request; the estimate routed between the place names.
          </p>
        )}
      </Section>
      <Section title="Trip">
        <dl className="flex flex-col gap-1">
          <Row label="Equipment to load">
            <span className="font-medium">{truck.loadDescription ?? '--'}</span>
          </Row>
          <Row label="Company">{truck.companyName ?? '--'}</Row>
          <Row label="Customer">
            {truck.requesterName ?? '--'}
            {truck.requesterPhone && (
              <>
                {' · '}
                <a className="underline" href={`tel:${truck.requesterPhone.replace(/[^\d+]/g, '')}`}>
                  {truck.requesterPhone}
                </a>
                <MessengerLinks phone={truck.requesterPhone} />
              </>
            )}
          </Row>
          <Row label="Pickup">{formatDateTime(truck.scheduledFor)}</Row>
          <Row label="Est. arrival">{truck.etaAt ? formatDateTime(truck.etaAt)
            : truck.routeMinutes !== null ? `~ pickup + ${truck.routeMinutes} min drive` : '--'}</Row>
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
          <Row label="Customer accepted">
            {truck.agreedPricePhp === null ? '--' : truck.acceptedPricePhp === truck.agreedPricePhp ? 'Yes' : 'Not yet'}
          </Row>
        </dl>
      </Section>
    </div>
  );
}

export function BookingDrawer({
  target,
  truck,
  initialTab = 'overview',
  onClose,
}: {
  target: BookingDrawerTarget | null;
  truck: TruckRequestResponse | undefined;
  initialTab?: DrawerTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  useEffect(() => setTab(initialTab), [target?.id, initialTab]);
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
          <Link to="/app/bookings/$bookingId" params={{ bookingId: rentalId }} className={buttonClass('ghost')}>Open as a full page</Link>
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
                <NegotiationThread base={`/bookings/${rentalId}`} disabled={booking.data.status === 'cancelled'} />
              )}
              {tab === 'actions' && <BookingSide booking={booking.data} />}
            </>
          )}
          {shownTruck && (
            <>
              {tab === 'overview' && <TruckOverview truck={shownTruck} />}
              {tab === 'negotiation' && (
                <NegotiationThread
                  base={`/truck-requests/${shownTruck.id}`}
                  disabled={shownTruck.status === 'cancelled' || shownTruck.status === 'paid' || shownTruck.status === 'dispatched'}
                />
              )}
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
