import { createRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizePhMobile, PH_MOBILE_REGEX, quoteExpiresAt, type BookingDetailResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { useTenant } from '../lib/tenant.js';
import { bookingsQueries, quotesQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { formatDate, formatPeso, shortCode } from '../lib/format.js';
import { amountDue } from './account.checkout.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button, buttonClass } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { StatusPill } from '../components/status-pill.js';
import { Check, Clock } from 'lucide-react';
import { NegotiationThread } from '../components/negotiation-thread.js';
import { QuoteLines } from '../components/quote-lines.js';
import { PrintFrame } from '../components/print-frame.js';
import { useToast } from '../components/toast.js';
import { LoadError } from '../components/load-error.js';
import { Skeleton } from '../components/skeleton.js';

// Only the accepted quote's engine-priced total is ever charged.

const heading = 'text-heading-md text-text';

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
        <StatusPill tone="recon-review" label="Being priced" icon={<Clock className="size-full" />} />
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
          <StatusPill tone="recon-approved" label="Agreed" icon={<Check className="size-full" />} />
        )}
      </div>
      <LineItems quoteId={quote.id} />
      <p className="font-mono text-3xl font-semibold text-text">{formatPeso(quote.totalPhp)}</p>

      {quote.status === 'approved' && !expired && (
        <>
          <p className="text-sm text-text-muted">
            This price is fixed until {formatDate(expiresAt)}. Accept to lock it, or negotiate: send
            a counter-offer in the conversation and the team will send you a revised quote.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={decide.isPending && decide.variables === 'accept'}
              onClick={() => decide.mutate('accept')}
            >
              Accept quote
            </Button>
            <Button variant="secondary" onClick={() => document.getElementById(`message-${booking.id}`)?.focus()}>
              Negotiate
            </Button>
            <Button
              variant="ghost"
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
        <Link to="/account/negotiation/$bookingId/final" params={{ bookingId: booking.id }} className={buttonClass('primary')}>Review and pay</Link>
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

// Only a 404/403 means the booking is not theirs; anything else is a retryable failure.
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
        <Link to="/account/bookings" className={buttonClass('primary')}>My bookings</Link>
      }
    />
  );
}

function NegotiationPage({ bookingId }: { bookingId: string }) {
  const booking = useQuery(bookingsQueries.detail(bookingId));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={booking.data ? `Booking ${booking.data.code}` : 'Booking'}
        description="Agree the price with the rental team before you pay."
        actions={
          <Link to="/account/bookings/$bookingId" params={{ bookingId }} className={buttonClass('ghost')}>Booking details</Link>
        }
      />
      {booking.isPending && <Skeleton label="Loading your booking" rows={3} />}
      {booking.isError && <LoadFailed error={booking.error} onRetry={() => booking.refetch()} />}
      {booking.data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <NegotiationThread base={`/bookings/${bookingId}`} disabled={booking.data.status === 'cancelled'} />
          <QuoteCard booking={booking.data} />
        </div>
      )}
    </div>
  );
}

function NegotiationRoute() {
  const { bookingId } = useParams({ strict: false }) as { bookingId: string };
  return <NegotiationPage bookingId={bookingId} />;
}

function NegotiationCallRoute() {
  const { bookingId } = accountNegotiationCallRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  const code = booking.data?.code;
  const tenant = useTenant();
  const mobile = tenant?.phone ? normalizePhMobile(tenant.phone) : '';
  const hasMobile = PH_MOBILE_REGEX.test(mobile);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Negotiate by phone" {...(code ? { description: `Booking ${code}` } : {})} />
      <Surface radius="md" elevation="sm" className="flex max-w-xl flex-col gap-3 p-6">
        <p className="text-sm text-text">
          {hasMobile ? 'Call or message the rental team on Viber or Telegram' : 'Call the rental team on the number on our contact page'} and quote your booking reference{' '}
          <span className="font-mono font-semibold">{code ?? '(loading)'}</span>.
        </p>
        <p className="text-sm text-text-muted">
          Whatever you agree on the call comes back here as a revised quote for you to accept, so
          the price you pay is always the one written down.
        </p>
        <div className="flex flex-wrap gap-2">
          {hasMobile ? (
            <>
              <a href={`viber://call?number=${encodeURIComponent(mobile)}`} className={buttonClass('primary')}>Call on Viber</a>
              <a href={`https://t.me/${mobile}`} target="_blank" rel="noreferrer" className={buttonClass('primary')}>Message on Telegram</a>
            </>
          ) : (
            <Link to="/contact" className={buttonClass('primary')}>Contact page</Link>
          )}
          <Link to="/account/negotiation/$bookingId" params={{ bookingId }} className={buttonClass('secondary')}>Back to the conversation</Link>
        </div>
      </Surface>
    </div>
  );
}

function NegotiationFinalRoute() {
  const { bookingId } = accountNegotiationFinalRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  const quoteId = booking.data?.quotation?.id ?? '';
  const quote = useQuery({ ...quotesQueries.detail(quoteId), enabled: Boolean(quoteId) });
  const accepted = booking.data?.quotation?.status === 'accepted';
  const due = booking.data ? amountDue(booking.data) : null;
  const totalDue = due?.total != null ? formatPeso(due.total) : '--';

  if (booking.isError)
    return <LoadFailed error={booking.error} onRetry={() => booking.refetch()} />;
  if (booking.data && !accepted) {
    return (
      <EmptyState
        title="Nothing agreed yet"
        description="Accept the quote on the negotiation page first; this summary appears once you have."
        action={
          <Link to="/account/negotiation/$bookingId" params={{ bookingId }} className={buttonClass('primary')}>Back to negotiation</Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5">
      <div className="w-full">
        <PrintFrame
          title="Agreed quotation"
          docRef={quote.data ? `${shortCode('quote', quote.data.id)} rev ${quote.data.revision}` : '--'}
          issuedAt={quote.data?.createdAt ?? null}
          details={[
            ['Booking', booking.data?.code ?? '--'],
            ['Status', 'Accepted by the customer'],
            ['Valid until', quote.data?.createdAt ? formatDate(quoteExpiresAt(quote.data.createdAt)) : '--'],
            ['Total due', totalDue],
          ]}
        />
      </div>
      <StatusPill tone="recon-approved" label="Agreed" icon={<Check className="size-full" />} />
      <div className="text-center">
        <h1 className="text-display-md text-text">Negotiation finalised</h1>
        <p className="mt-1 text-sm text-text-muted">
          These are the terms you accepted. Review them, then pay.
        </p>
      </div>
      <Surface radius="md" elevation="sm" className="flex w-full flex-col gap-3 p-5">
        <h2 className={heading}>Summary &middot; revision {quote.data?.revision ?? '--'}</h2>
        <LineItems quoteId={quoteId} />
        <Row label="Consumable deposit" value={formatPeso(due?.deposit ?? 0)} />
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm font-medium text-text">
            Total due
          </span>
          <span className="font-mono text-display-md text-text">
            {totalDue}
          </span>
        </div>
      </Surface>
      <div data-print-hide className="flex w-full flex-wrap gap-2">
        <Button variant="ghost" className="flex-1" onClick={() => window.print()}>
          Print quote
        </Button>
        <Link to="/account/checkout/$bookingId" params={{ bookingId }} className={buttonClass('primary', 'default', 'flex-1 w-full')}>
          Proceed to payment
        </Link>
        <Link to="/account/bookings/$bookingId" params={{ bookingId }} className={buttonClass('secondary', 'default', 'flex-1 w-full')}>
          Booking details
        </Link>
      </div>
    </div>
  );
}

function LineItems({ quoteId }: { quoteId: string }) {
  const quote = useQuery({ ...quotesQueries.detail(quoteId), enabled: Boolean(quoteId) });
  if (!quote.data?.lineItems.length) return null;
  return <QuoteLines quote={quote.data} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

// Siblings, not nested: reading a parent's params from a sibling throws "Could not find an active match".
export const accountNegotiationRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$bookingId',
  component: NegotiationRoute,
});

export const accountNegotiationChatRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$bookingId/chat',
  component: NegotiationRoute,
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
