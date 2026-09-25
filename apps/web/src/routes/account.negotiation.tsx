import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quoteExpiresAt, type BookingDetailResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries, quotesQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { formatDate, formatPeso, shortCode } from '../lib/format.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon, ClockIcon } from '../components/icons.js';
import { NegotiationThread } from '../components/negotiation-thread.js';
import { useToast } from '../components/toast.js';
import { LoadError } from '../components/load-error.js';
import { Skeleton } from '../components/skeleton.js';

// Figma 219:2226 (Proceed to Negotiation), 225:3084 (Messenger Chat Nego),
// 225:3085 (Call Nego), 225:3087 (Nego Finalized), 238:2649 (Manage Nego
// Details). Negotiation is a conversation beside the current quote: the
// customer counters in the thread, staff answer with a revised quote, and
// the customer accepts or declines the quote itself. Only the accepted
// quote's engine-priced total is ever charged.

const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';

function QuoteCard({ booking }: { booking: BookingDetailResponse }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const quote = booking.quotation;

  const decide = useMutation({
    mutationFn: (action: 'accept' | 'decline') => apiPost(`/quotes/${quote?.id}/${action}`, {}),
    onSuccess: async (_data, action) => {
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      if (action === 'accept') {
        navigate({
          to: '/account/negotiation/$bookingId/final',
          params: { bookingId: booking.id },
        });
      } else {
        toast.success('Quote declined', 'The rental team can send you a revised one.');
      }
    },
    onError: (err) => toast.error('That did not go through', apiErrorText(err)),
  });

  if (!quote || quote.status === 'draft' || quote.status === 'superseded') {
    return (
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
        <h2 className={heading}>Quote</h2>
        <StatusPill tone="recon-review" label="Being priced" icon={<ClockIcon />} />
        <p className="text-sm text-text-muted">
          The rental team is pricing this booking against today&rsquo;s diesel rate. You will get a
          notification when the quote is ready. Tell them anything that affects the price in the
          conversation.
        </p>
      </Surface>
    );
  }

  const expiresAt = quoteExpiresAt(quote.createdAt);
  const expired = expiresAt < new Date();

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={heading}>Quote &middot; revision {quote.revision}</h2>
        {quote.status === 'accepted' && (
          <StatusPill tone="recon-approved" label="Agreed" icon={<CheckIcon />} />
        )}
      </div>
      <LineItems quoteId={quote.id} />
      <p className="font-mono text-3xl font-semibold text-text">{formatPeso(quote.totalPhp)}</p>

      {quote.status === 'approved' && !expired && (
        <>
          <p className="text-sm text-text-muted">
            Valid until {formatDate(expiresAt)}. Accept to lock this price, or send a counter-offer
            in the conversation and the team will revise it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={decide.isPending && decide.variables === 'accept'}
              onClick={() => decide.mutate('accept')}
            >
              Accept quote
            </Button>
            <Button
              variant="secondary"
              loading={decide.isPending && decide.variables === 'decline'}
              onClick={() => decide.mutate('decline')}
            >
              Decline
            </Button>
          </div>
        </>
      )}
      {quote.status === 'approved' && expired && (
        <p className="text-sm text-text-muted">
          This quote expired on {formatDate(expiresAt)}. Ask for a fresh one in the conversation.
        </p>
      )}
      {quote.status === 'rejected' && (
        <p className="text-sm text-text-muted">
          You declined this revision. The team can send a revised quote, or you can cancel the
          booking from its page.
        </p>
      )}
      {quote.status === 'accepted' && (
        <Link to="/account/negotiation/$bookingId/final" params={{ bookingId: booking.id }}>
          <Button variant="primary">Review and pay</Button>
        </Link>
      )}

      <Link
        to="/account/negotiation/$bookingId/call"
        params={{ bookingId: booking.id }}
        className="text-sm text-accent underline"
      >
        Rather talk it through on the phone?
      </Link>
    </Surface>
  );
}

function useBooking(bookingId: string) {
  return useQuery(bookingsQueries.detail(bookingId));
}

// Only a 404/403 means the booking is not this customer's; anything else is
// a failed load they can retry, not "booking not found".
function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && (error.status === 404 || error.status === 403))
    return <NotFound />;
  return (
    <LoadError
      message="This booking could not be loaded just now. Check your connection and try again."
      onRetry={onRetry}
    />
  );
}

function NotFound() {
  return (
    <EmptyState
      title="Booking not found"
      description="This booking does not exist, or it belongs to another account."
      action={
        <Link to="/account/bookings">
          <Button variant="primary">My bookings</Button>
        </Link>
      }
    />
  );
}

function NegotiationPage({ bookingId }: { bookingId: string }) {
  const booking = useBooking(bookingId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Negotiation"
        title={`Booking ${shortCode('booking', bookingId)}`}
        description="Agree the price with the rental team before you pay."
        actions={
          <Link to="/account/bookings/$bookingId" params={{ bookingId }}>
            <Button variant="ghost">Booking details</Button>
          </Link>
        }
      />
      {booking.isPending && <Skeleton label="Loading your booking" rows={3} />}
      {booking.isError && <LoadFailed error={booking.error} onRetry={() => booking.refetch()} />}
      {booking.data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <NegotiationThread bookingId={bookingId} disabled={booking.data.status === 'cancelled'} />
          <QuoteCard booking={booking.data} />
        </div>
      )}
    </div>
  );
}

function NegotiationRoute() {
  const { bookingId } = accountNegotiationRoute.useParams();
  return <NegotiationPage bookingId={bookingId} />;
}

// /chat is the Figma frame's own URL; it is the same screen.
function NegotiationChatRoute() {
  const { bookingId } = accountNegotiationChatRoute.useParams();
  return <NegotiationPage bookingId={bookingId} />;
}

// Figma 225:3085. There is no telephony here and no yard phone number in
// the data, so the call happens off-app; what comes back into the app is
// the revised quote the team sends after it.
function NegotiationCallRoute() {
  const { bookingId } = accountNegotiationCallRoute.useParams();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Negotiation"
        title="Negotiate by phone"
        description={`Booking ${shortCode('booking', bookingId)}`}
      />
      <Surface radius="md" elevation="sm" className="flex max-w-xl flex-col gap-3 p-6">
        <p className="text-sm text-text">
          Call the rental team on the number on our contact page and quote your booking reference{' '}
          <span className="font-mono font-semibold">{shortCode('booking', bookingId)}</span>.
        </p>
        <p className="text-sm text-text-muted">
          Whatever you agree on the call comes back here as a revised quote for you to accept, so
          the price you pay is always the one written down.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/contact">
            <Button variant="primary">Contact page</Button>
          </Link>
          <Link to="/account/negotiation/$bookingId" params={{ bookingId }}>
            <Button variant="secondary">Back to the conversation</Button>
          </Link>
        </div>
      </Surface>
    </div>
  );
}

// Figma 225:3087 "Negotiation Finalized": the agreed numbers, then pay.
function NegotiationFinalRoute() {
  const { bookingId } = accountNegotiationFinalRoute.useParams();
  const booking = useBooking(bookingId);
  const quoteId = booking.data?.quotation?.id ?? '';
  const quote = useQuery({ ...quotesQueries.detail(quoteId), enabled: Boolean(quoteId) });
  const accepted = booking.data?.quotation?.status === 'accepted';
  const deposit = booking.data?.deposit.required ?? 0;

  if (booking.isError)
    return <LoadFailed error={booking.error} onRetry={() => booking.refetch()} />;
  if (booking.data && !accepted) {
    return (
      <EmptyState
        title="Nothing agreed yet"
        description="Accept the quote on the negotiation page first; this summary appears once you have."
        action={
          <Link to="/account/negotiation/$bookingId" params={{ bookingId }}>
            <Button variant="primary">Back to negotiation</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5">
      <StatusPill tone="recon-approved" label="Agreed" icon={<CheckIcon />} />
      <div className="text-center">
        <h1 className="font-display text-2xl font-semibold text-text">Negotiation finalised</h1>
        <p className="mt-1 text-sm text-text-muted">
          These are the terms you accepted. Review them, then pay.
        </p>
      </div>
      <Surface radius="md" elevation="sm" className="flex w-full flex-col gap-3 p-5">
        <h2 className={heading}>Summary &middot; revision {quote.data?.revision ?? '--'}</h2>
        <LineItems quoteId={quoteId} />
        <Row label="Rental subtotal" value={formatPeso(quote.data?.subtotal)} />
        {Boolean(quote.data?.discount) && (
          <Row label="Negotiated discount" value={`- ${formatPeso(quote.data?.discount)}`} />
        )}
        <Row label="Agreed rental price" value={formatPeso(quote.data?.total)} />
        <Row label="Refundable deposit" value={formatPeso(deposit)} />
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
            Total due
          </span>
          <span className="font-mono text-2xl font-semibold text-text">
            {quote.data ? formatPeso(quote.data.total + deposit) : '--'}
          </span>
        </div>
      </Surface>
      <div data-print-hide className="flex w-full flex-wrap gap-2">
        <Button variant="ghost" className="flex-1" onClick={() => window.print()}>
          Print quote
        </Button>
        <Link to="/account/checkout/$bookingId" params={{ bookingId }} className="flex-1">
          <Button variant="primary" className="w-full">
            Proceed to payment
          </Button>
        </Link>
        <Link to="/account/bookings/$bookingId" params={{ bookingId }} className="flex-1">
          <Button variant="secondary" className="w-full">
            Booking details
          </Button>
        </Link>
      </div>
    </div>
  );
}

// Each quoted line with its own price, so the customer sees what makes up
// the total, not just the total.
function LineItems({ quoteId }: { quoteId: string }) {
  const quote = useQuery({ ...quotesQueries.detail(quoteId), enabled: Boolean(quoteId) });
  if (!quote.data?.lineItems.length) return null;
  return (
    <ul aria-label="Quote line items" className="flex flex-col gap-2 border-b border-border pb-3">
      {quote.data.lineItems.map((item, i) => (
        <li key={i} className="flex items-start justify-between gap-3 text-sm">
          <span className="text-text">
            {item.quantity} &times; {item.equipmentTypeName ?? 'Equipment'}
            <span className="block text-xs text-text-muted">
              {item.estimatedHours} h at {formatPeso(item.hourlyRate)}/h, plus operating and mobilisation
            </span>
          </span>
          <span className="font-mono text-text">{formatPeso(item.subtotal)}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

// Siblings, not nested: each screen reads its OWN route's params (see the
// note this replaced in unbacked-screens.tsx -- reading the parent's
// params from a sibling throws "Could not find an active match").
export const accountNegotiationRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$bookingId',
  component: NegotiationRoute,
});

export const accountNegotiationChatRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$bookingId/chat',
  component: NegotiationChatRoute,
});

export const accountNegotiationCallRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$bookingId/call',
  component: NegotiationCallRoute,
});

export const accountNegotiationFinalRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$bookingId/final',
  component: NegotiationFinalRoute,
});
