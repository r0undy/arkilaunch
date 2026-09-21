import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { BookingDetailResponse, CheckoutMethod } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { StatusPill } from '../components/status-pill.js';
import { AlertIcon } from '../components/icons.js';
import { formatDate, formatPeso, formatStatus, shortCode } from '../lib/format.js';

type PaymentMethod = CheckoutMethod | 'manual';

// Figma 168:2161 (Digital Bank) and 216:2049 (Bank Transfer). The frames
// collect card numbers, a GCash login (168:3138) and an OTP (168:3214) in
// this app. None of that is built on purpose: the customer picks a
// channel here and PayMongo's hosted page runs the wallet or bank login
// and the OTP, so no credential ever reaches ArkiLaunch (DSD §4.1 "Don't:
// collect card data in-app") and there is no card-data compliance scope.
const METHODS: { id: PaymentMethod; title: string; description: string }[] = [
  { id: 'gcash', title: 'GCash', description: 'You log in to GCash and confirm with its OTP on the secure payment page.' },
  { id: 'paymaya', title: 'Maya', description: 'You log in to Maya and confirm on the secure payment page.' },
  { id: 'dob', title: 'Online banking', description: 'Pay straight from your bank account (BPI, UnionBank) through your bank’s own login.' },
  { id: 'card', title: 'Credit or debit card', description: 'Visa or Mastercard, entered on the payment provider’s page, not ours.' },
  {
    id: 'manual',
    title: 'Bank deposit or company cheque',
    description: 'Settle offline. The booking stays pending until our billing team confirms the funds.',
  },
];

// What this checkout will charge, as the server will compute it: the
// accepted quote plus deposit, or a reservation deposit when no quote
// exists. Shown, never sent -- the API prices the charge itself.
export function amountDue(booking: BookingDetailResponse): { rent: number; deposit: number | null; total: number | null } {
  const quote = booking.quotation;
  if (quote?.status === 'accepted') {
    const rent = quote.totalPhp ?? 0;
    const depositPaid = booking.invoices.some((i) => i.invoiceType === 'deposit' && i.status === 'paid');
    const deposit = depositPaid ? 0 : (booking.deposit.required ?? 0);
    return { rent, deposit, total: rent + deposit };
  }
  const issued = booking.invoices.find((i) => i.invoiceType === 'deposit' && i.status === 'issued');
  return { rent: 0, deposit: issued?.amount ?? null, total: issued?.amount ?? null };
}

function OrderSummary({ booking }: { booking: BookingDetailResponse }) {
  const due = amountDue(booking);

  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-4 p-5">
      <h2 className="font-display text-lg font-semibold text-text">Order summary</h2>

      <div className="flex flex-col gap-3 border-b border-border pb-4">
        {booking.items.map((item) => (
          <div key={`${item.equipmentId}-${String(item.start)}`} className="flex flex-col">
            <p className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
              {shortCode('equipment', item.equipmentId)}
            </p>
            <p className="text-sm text-text-muted">
              {formatDate(item.start)}
              {item.end ? ` - ${formatDate(item.end)}` : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {booking.quotation?.status === 'accepted' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">Agreed rental (revision {booking.quotation.revision})</span>
            <span className="font-mono text-text">{formatPeso(due.rent)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">Refundable deposit</span>
          <span className="font-mono text-text">{due.deposit === null ? 'Set at payment' : formatPeso(due.deposit)}</span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-border pt-4">
        <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">Total amount</span>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold text-text">{due.total === null ? '--' : formatPeso(due.total)}</p>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">PHP</p>
        </div>
      </div>
    </Surface>
  );
}

function checkoutError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.message;
    if (code === 'quote_not_accepted') return 'Accept the quote on the negotiation page before paying.';
    if (code === 'already_paid') return 'This booking is already paid. The receipt is on the booking page.';
    if (code === 'rate_limited') return 'Too many payment attempts just now. Wait a minute and try again.';
  }
  return apiErrorText(err);
}

function CheckoutForm({ booking }: { booking: BookingDetailResponse }) {
  const navigate = useNavigate();
  const [method, setMethod] = useState<PaymentMethod>('gcash');
  const [unavailable, setUnavailable] = useState(false);

  const checkout = useMutation({
    mutationFn: (chosen: CheckoutMethod) =>
      apiPost<{ checkoutUrl: string }>(`/bookings/${booking.id}/checkout`, { method: chosen }),
    onSuccess: (data) => {
      // With no payment provider configured the API answers with the stub
      // adapter's placeholder ("about:blank?amount=..."), a successful
      // response carrying a URL that is not a payment page. Check the
      // destination is a real http(s) page before leaving the app.
      if (/^https?:\/\//i.test(data.checkoutUrl)) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      setUnavailable(true);
    },
  });

  if (booking.quotation && booking.quotation.status !== 'accepted') {
    return (
      <EmptyState
        title="Agree the price first"
        description="This booking has a quote you have not accepted yet. Accept it, or negotiate it, and then come back to pay."
        action={
          <Link to="/account/negotiation/$bookingId" params={{ bookingId: booking.id }}>
            <Button variant="primary">Go to negotiation</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,380px)]">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
          How would you like to pay?
        </legend>
        {METHODS.map((option) => (
          <label
            key={option.id}
            className={[
              'flex cursor-pointer items-start gap-3 rounded-md border bg-surface p-4',
              method === option.id ? 'border-primary' : 'border-border hover:border-accent',
            ].join(' ')}
          >
            <input
              type="radio"
              name="payment-method"
              value={option.id}
              checked={method === option.id}
              onChange={() => setMethod(option.id)}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
            />
            <span className="min-w-0">
              <span className="block font-display text-base font-semibold text-text">{option.title}</span>
              <span className="mt-1 block text-sm text-text-muted">{option.description}</span>
            </span>
          </label>
        ))}
        {booking.siteCity && (
          <p className="text-sm text-text-muted">
            Delivering to {booking.siteCity}
            {booking.siteContact ? `, contact ${booking.siteContact}` : ''}.
          </p>
        )}
      </fieldset>

      <div className="flex min-w-0 flex-col gap-3">
        <OrderSummary booking={booking} />

        {method === 'manual' ? (
          <Button variant="secondary" onClick={() => navigate({ to: '/account/checkout/success' })}>
            Confirm and settle offline
          </Button>
        ) : (
          <Button variant="primary" loading={checkout.isPending} onClick={() => checkout.mutate(method)}>
            Pay now
          </Button>
        )}

        {checkout.isError && <p className="text-sm text-error">{checkoutError(checkout.error)}</p>}
        {unavailable && (
          <p className="text-sm text-error">
            Online payment is not switched on in this environment, so nothing was charged. The booking
            stays {formatStatus(booking.status).toLowerCase()} as {shortCode('booking', booking.id)}.
          </p>
        )}

        <p className="text-center text-xs text-text-muted">
          You finish paying on PayMongo&rsquo;s secure page. By paying you agree to the{' '}
          <Link to="/terms" className="underline">rental agreement</Link> and{' '}
          <Link to="/privacy" className="underline">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}

function CheckoutPage() {
  const { bookingId } = accountCheckoutRoute.useParams();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Checkout"
        title="Payment information"
        description="Choose how to settle this booking."
        actions={
          <Link to="/account/bookings/$bookingId" params={{ bookingId }}>
            <Button variant="ghost">Back</Button>
          </Link>
        }
      />
      <DataPanel
        title="Booking"
        options={bookingsQueries.detail(bookingId)}
        emptyTitle="Booking not found"
        emptyDescription="This booking does not exist, or it belongs to another account."
        isEmpty={(data) => !data?.id}
        render={(data) => <CheckoutForm booking={data} />}
      />
    </div>
  );
}

// PayMongo's cancel_url (PAYMONGO_CANCEL_URL). Reaching it means the
// customer backed out or the wallet/bank declined -- nothing was charged,
// and the webhook remains the authority either way.
function CheckoutFailedPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Checkout" title="Payment not completed" />
      <Surface radius="md" elevation="sm" className="flex flex-col items-start gap-4 p-6">
        <StatusPill tone="recon-failed" label="Not paid" icon={<AlertIcon />} />
        <p className="max-w-prose text-sm text-text-muted">
          The payment was cancelled or declined before it went through, so nothing was charged and your
          booking is unchanged. You can try again with the same or a different method.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/account/bookings">
            <Button variant="primary">My bookings</Button>
          </Link>
          <Link to="/contact">
            <Button variant="secondary">Get help</Button>
          </Link>
        </div>
      </Surface>
    </div>
  );
}

export const accountCheckoutRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/checkout/$bookingId',
  component: CheckoutPage,
});

export const accountCheckoutFailedRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/checkout/failed',
  component: CheckoutFailedPage,
});
