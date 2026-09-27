import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse, CheckoutMethod, CouponPreviewResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries, companiesQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
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
  { id: 'qrph', title: 'QR Ph', description: 'Scan the QR code with any banking or e-wallet app that supports QR Ph.' },
  { id: 'dob', title: 'Online banking', description: 'Pay straight from your bank account (BPI, UnionBank) through your bank’s own login.' },
  { id: 'card', title: 'Credit or debit card', description: 'Visa or Mastercard, entered on the payment provider’s page, not ours.' },
  {
    id: 'manual',
    title: 'Cash, bank deposit or company cheque',
    description: 'Get an invoice now and pay at our office. The booking stays pending until our billing team records the payment.',
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
    // An invoice already issued is charged as it stands (a coupon may have lowered its rent).
    const issued = booking.invoices.find((i) => i.invoiceType === 'booking' && i.status === 'issued');
    return { rent, deposit, total: issued?.amount ?? rent + deposit };
  }
  const issued = booking.invoices.find((i) => i.invoiceType === 'deposit' && i.status === 'issued');
  return { rent: 0, deposit: issued?.amount ?? null, total: issued?.amount ?? null };
}

function OrderSummary({ booking, coupon }: { booking: BookingDetailResponse; coupon: CouponPreviewResponse | null }) {
  const due = amountDue(booking);
  const total = coupon ? coupon.totalPhp : due.total;

  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-4 p-5">
      <h2 className="text-lg font-semibold text-text">Order summary</h2>

      <div className="flex flex-col gap-3 border-b border-border pb-4">
        {booking.items.map((item) => (
          <div key={`${item.equipmentId}-${String(item.start)}`} className="flex flex-col">
            <p className="text-sm font-semibold uppercase tracking-[0.04em] text-text">
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
        {coupon && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">Coupon {coupon.code}</span>
            <span className="font-mono text-success">-{formatPeso(coupon.discountPhp)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">Consumable deposit</span>
          <span className="font-mono text-text">{due.deposit === null ? 'Set at payment' : formatPeso(due.deposit)}</span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-border pt-4">
        <span className="text-sm font-semibold uppercase tracking-[0.04em] text-text">Total amount</span>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold text-text">{total === null ? '--' : formatPeso(total)}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">PHP</p>
        </div>
      </div>
    </Surface>
  );
}

function checkoutError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.message;
    if (code === 'quote_not_accepted') return 'Accept the quote on the negotiation page before paying.';
    if (code === 'company_not_verified') return 'Your company is still being verified. Payment opens once it is.';
    if (code === 'already_paid') return 'This booking is already paid. The receipt is on the booking page.';
    if (code === 'call_not_confirmed') return 'The rental team confirms every booking by phone first. Request a call above.';
    if (code === 'rate_limited') return 'Too many payment attempts just now. Wait a minute and try again.';
    if (code === 'coupon_invalid') return 'That coupon code is not valid for this booking.';
    if (code === 'coupon_used') return 'Your company has already used this coupon.';
    if (code === 'coupon_already_applied') return 'This booking already has a coupon applied.';
    if (code === 'amount_below_minimum') return 'Online payment needs at least PHP 1.00. Choose cash at the office instead.';
    if (code === 'payment_in_progress') return 'A payment for this booking is going through. Check the booking page in a minute.';
  }
  return apiErrorText(err);
}

// The customer names a code; the server says what it takes off (the rent
// only) and checkout re-checks it. Nothing here computes money.
function CouponField({
  bookingId,
  applied,
  onApplied,
}: {
  bookingId: string;
  applied: CouponPreviewResponse | null;
  onApplied: (coupon: CouponPreviewResponse | null) => void;
}) {
  const [code, setCode] = useState('');
  const preview = useMutation({
    mutationFn: (value: string) => apiPost<CouponPreviewResponse>(`/bookings/${bookingId}/coupon`, { code: value }),
    onSuccess: (data) => onApplied(data),
  });

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text">
          Coupon <span className="font-mono">{applied.code}</span> applied
        </span>
        <Button variant="ghost" onClick={() => onApplied(null)}>
          Remove
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim()) preview.mutate(code.trim().toUpperCase());
      }}
    >
      <div className="min-w-0 flex-1">
        <Input
          label="Coupon code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          error={preview.isError ? checkoutError(preview.error) : undefined}
        />
      </div>
      <Button type="submit" variant="secondary" loading={preview.isPending}>
        Apply
      </Button>
    </form>
  );
}

function CheckoutForm({ booking }: { booking: BookingDetailResponse }) {
  const navigate = useNavigate();
  const [method, setMethod] = useState<PaymentMethod>('gcash');
  const [unavailable, setUnavailable] = useState(false);
  const [coupon, setCoupon] = useState<CouponPreviewResponse | null>(null);

  const checkout = useMutation({
    mutationFn: (chosen: PaymentMethod) =>
      apiPost<{ checkoutUrl: string | null; invoiceId: string }>(`/bookings/${booking.id}/checkout`, {
        ...(chosen === 'manual' ? { cash: true } : { method: chosen }),
        ...(coupon ? { couponCode: coupon.code } : {}),
      }),
    onSuccess: (data) => {
      // Offline: a real issued invoice to pay against, no PayMongo session.
      if (data.checkoutUrl === null) {
        void navigate({ to: '/account/invoices/$invoiceId', params: { invoiceId: data.invoiceId } });
        return;
      }
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

  const queryClient = useQueryClient();
  const requestCall = useMutation({
    mutationFn: () => apiPost(`/bookings/${booking.id}/request-call`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey }),
  });

  const companies = useQuery(companiesQueries.mine());
  const company = companies.data?.find((c) => c.id === booking.customerId);
  if (company && company.kycStatus !== 'approved') {
    return (
      <EmptyState
        title={company.kycStatus === 'rejected' ? 'Company not verified' : 'Waiting for verification'}
        description={
          company.kycStatus === 'rejected'
            ? `${company.companyName} could not be verified, so this booking cannot be paid yet. Contact the rental team to sort it out.`
            : `The rental team is checking ${company.companyName}'s documents. Your quote is safe; you will get a notification when payment opens.`
        }
        action={
          <Link to="/account/companies">
            <Button variant="primary">View company</Button>
          </Link>
        }
      />
    );
  }

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

  if (!booking.callConfirmedAt) {
    return (
      <EmptyState
        title={booking.callRequestedAt ? 'Call requested' : 'Confirm by phone first'}
        description={
          booking.callRequestedAt
            ? 'The rental team will ring you to confirm this booking. Payment opens once they have.'
            : 'The rental team confirms every booking by phone before you pay. Ask them to call you.'
        }
        action={
          <Button variant="primary" loading={requestCall.isPending} onClick={() => requestCall.mutate()}>
            {booking.callRequestedAt ? 'Request call again' : 'Request call'}
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,380px)]">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-[0.04em] text-text">
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
              <span className="block text-base font-semibold text-text">{option.title}</span>
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
        <OrderSummary booking={booking} coupon={coupon} />
        {booking.quotation?.status === 'accepted' && (
          <CouponField bookingId={booking.id} applied={coupon} onApplied={setCoupon} />
        )}

        {method === 'manual' ? (
          <Button variant="secondary" loading={checkout.isPending} onClick={() => checkout.mutate('manual')}>
            Get invoice and pay offline
          </Button>
        ) : (
          <Button variant="primary" loading={checkout.isPending} onClick={() => checkout.mutate(method)}>
            Pay now
          </Button>
        )}

        {checkout.isError && <p role="alert" className="text-sm text-error">{checkoutError(checkout.error)}</p>}
        {unavailable && (
          <p role="alert" className="text-sm text-error">
            Online payment is not switched on in this environment, so nothing was charged. The booking
            stays {formatStatus(booking.status).toLowerCase()} as {booking.code}.
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

// PayMongo's cancel_url (set per session, back to this storefront). Reaching it means the
// customer backed out or the wallet/bank declined -- nothing was charged,
// and the webhook remains the authority either way.
function CheckoutFailedPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Payment not completed" />
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
