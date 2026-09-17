import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries, equipmentQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, ClockIcon } from '../components/icons.js';
import { formatDate, formatPeso, formatStatus, shortCode } from '../lib/format.js';

const STATUS_TONES: Record<string, StatusTone> = {
  confirmed: 'recon-approved',
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
        {booking.items.map((item) => (
          <MachineCard key={`${item.equipmentId}-${String(item.start)}`} equipmentId={item.equipmentId} />
        ))}

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
              No return date is set on this booking yet, so there is no progress to show.
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
          <div key={invoice.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-muted">
              {formatStatus(invoice.invoiceType)} &middot; {formatStatus(invoice.status)}
            </span>
            <span className="font-mono text-text">{formatPeso(invoice.amount)}</span>
          </div>
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
    </div>
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
            <Link to="/account/bookings/$bookingId/extend" params={{ bookingId }}>
              <Button variant="secondary">Extend rental</Button>
            </Link>
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
// There is no endpoint that extends a booking: the bookings API is create,
// list and read, and payments.service owns the only write after that. A
// date picker here would collect a request nothing receives, so the screen
// names the gap and routes the customer to the channel that does work.
function ExtendRentalPage() {
  const { bookingId } = accountBookingExtendRoute.useParams();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My bookings"
        title="Extend rental"
        description={`Booking ${shortCode('booking', bookingId)}`}
      />
      <EmptyState
        title="Extensions are arranged by the yard, not here yet"
        description="Nothing in the API extends a live booking -- bookings can be created, listed and read, and no endpoint moves a return date. Rather than take a request that would go nowhere, this screen points you at the people who can action it."
        action={
          <Link to="/contact">
            <Button variant="primary">Contact the yard</Button>
          </Link>
        }
      />
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
