import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { formatDate, formatPeso, formatStatus, shortCode } from '../lib/format.js';

type PaymentMethod = 'online' | 'manual';

// The Figma frame (168:2161) offers four methods, three of which collect
// payment credentials in this app: card fields on the Bank Transfer option,
// a GCash authentication hop, and an OTP screen. None of those are built.
// DSD §4.1 says "Don't: collect card data in-app" and
// cr-arkilaunch-frontend-storefront-shell.md §4 already superseded them with
// PayMongo hosted checkout, so the card, wallet and bank choice is made on
// PayMongo's page, not ours. What survives from the frame is its real
// structure: a method choice beside an order summary, and one Pay action.
const METHODS: { id: PaymentMethod; title: string; description: string }[] = [
  {
    id: 'online',
    title: 'Pay online',
    description:
      'Card, GCash, or online bank transfer. You finish the payment on our provider’s secure page; ArkiLaunch never sees your card or wallet credentials.',
  },
  {
    id: 'manual',
    title: 'Settle manually',
    description:
      'Pay the deposit by over-the-counter deposit or company cheque. The booking stays pending until our billing team confirms the funds.',
  },
];

function OrderSummary({ booking }: { booking: BookingDetailResponse }) {
  const invoiceTotal = booking.invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const total = booking.quotation?.totalPhp ?? invoiceTotal;

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

      {/* The frame itemizes subtotal, transport, insurance and tax. The
          quotation is the only priced object the API returns here, and
          inventing the other three lines would be inventing money, so the
          breakdown shows the invoices actually raised against the booking. */}
      <div className="flex flex-col gap-2">
        {booking.invoices.map((invoice) => (
          <div key={invoice.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-muted">
              {formatStatus(invoice.invoiceType)} &middot; {formatStatus(invoice.status)}
            </span>
            <span className="font-mono text-text">{formatPeso(invoice.amount)}</span>
          </div>
        ))}
        {booking.invoices.length === 0 && (
          <p className="text-sm text-text-muted">No invoice has been raised for this booking yet.</p>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-border pt-4">
        <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
          Total amount
        </span>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold text-text">{formatPeso(total)}</p>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            PHP
          </p>
        </div>
      </div>
    </Surface>
  );
}

function CheckoutForm({ booking }: { booking: BookingDetailResponse }) {
  const navigate = useNavigate();
  const [method, setMethod] = useState<PaymentMethod>('online');
  const [unavailable, setUnavailable] = useState(false);

  const checkout = useMutation({
    mutationFn: () => apiPost<{ checkoutUrl: string }>(`/bookings/${booking.id}/checkout`, {}),
    onSuccess: (data) => {
      // With no payment provider configured the API answers with the stub
      // adapter's placeholder ("about:blank?amount=..."), a successful
      // response carrying a URL that is not a payment page. Check the
      // destination is a real http(s) page before leaving the app --
      // account.cart.tsx learned this the hard way.
      if (/^https?:\/\//i.test(data.checkoutUrl)) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      setUnavailable(true);
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,380px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
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
                <span className="block font-display text-base font-semibold text-text">
                  {option.title}
                </span>
                <span className="mt-1 block text-sm text-text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
            Delivery site
          </h2>
          <p className="text-sm text-text">
            {booking.items.length} item{booking.items.length === 1 ? '' : 's'} on booking{' '}
            {shortCode('booking', booking.id)}, currently {formatStatus(booking.status)}.
          </p>
        </Surface>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <OrderSummary booking={booking} />

        {method === 'online' ? (
          <Button
            variant="primary"
            loading={checkout.isPending}
            onClick={() => checkout.mutate()}
          >
            Pay now
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => navigate({ to: '/account/checkout/success' })}>
            Confirm and settle manually
          </Button>
        )}

        {(checkout.isError || unavailable) && (
          <p className="text-sm text-error">
            Online payment is not available in this environment yet, so this booking stays unpaid.
            It is saved as {shortCode('booking', booking.id)} and will stay pending until the
            deposit is settled.
          </p>
        )}

        <p className="text-center text-xs text-text-muted">
          By paying you agree to the <Link to="/terms" className="underline">rental agreement</Link>{' '}
          and <Link to="/privacy" className="underline">privacy policy</Link>.
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
          <Link to="/account/bookings">
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

export const accountCheckoutRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/checkout/$bookingId',
  component: CheckoutPage,
});
