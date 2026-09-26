import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { accountLayoutRoute } from './_account.js';
import { apiPost } from '../lib/api-client.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon } from '../components/icons.js';

const POLL_MS = 3_000;
const POLL_FOR_MS = 60_000;

// Figma 168:3376 "Bank Transfer Successful". PayMongo's success_url, with
// ?invoice=<id> added per session. Arriving here proves nothing -- the URL
// can be typed -- so the page asks the API, which asks PayMongo server to
// server (POST /me/invoices/:id/confirm-payment) or has already heard the
// webhook. "Paid" shows only once the API says the invoice is paid.
function CheckoutSuccessPage() {
  const { invoice: invoiceId } = accountCheckoutSuccessRoute.useSearch();
  const [startedAt] = useState(() => Date.now());
  const confirm = useQuery({
    queryKey: ['confirm-payment', invoiceId],
    queryFn: () => apiPost<{ invoiceId: string; status: string }>(`/me/invoices/${invoiceId}/confirm-payment`, {}),
    enabled: Boolean(invoiceId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === 'issued' && Date.now() - startedAt < POLL_FOR_MS ? POLL_MS : false,
  });
  const paid = confirm.data?.status === 'paid';
  // Still asking: the last answer (if any) landed inside the polling window.
  const checking = Boolean(invoiceId) && !paid && !confirm.isError && confirm.dataUpdatedAt - startedAt < POLL_FOR_MS;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Checkout" title={paid ? 'Payment received' : 'Payment submitted'} />
      <Surface radius="md" elevation="sm" className="flex flex-col items-start gap-4 p-6">
        <StatusPill
          tone={paid ? 'recon-approved' : 'recon-review'}
          label={paid ? 'Paid' : checking ? 'Confirming…' : 'Submitted'}
          icon={<CheckIcon />}
        />
        <div className="flex flex-col gap-2" aria-live="polite">
          <h2 className="font-display text-xl font-semibold text-text">
            {paid ? 'Thanks -- your payment is confirmed.' : 'Thanks -- we have your payment instruction.'}
          </h2>
          <p className="max-w-prose text-sm text-text-muted">
            {paid
              ? 'The receipt is on the invoice, and a paid booking is now confirmed. The rental team will be in touch about delivery.'
              : checking
                ? 'Checking with the payment provider. This usually takes a few seconds.'
                : 'Your booking stays pending until the funds clear. That usually lands within minutes for online payments. You will see the booking move to confirmed on this account, and the receipt appears against its invoice.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {invoiceId && (
            <Link to="/account/invoices/$invoiceId" params={{ invoiceId }}>
              <Button variant="primary">View invoice</Button>
            </Link>
          )}
          <Link to="/account/bookings">
            <Button variant={invoiceId ? 'secondary' : 'primary'}>View my bookings</Button>
          </Link>
        </div>
      </Surface>
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const accountCheckoutSuccessRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/checkout/success',
  validateSearch: (search: Record<string, unknown>): { invoice?: string } =>
    typeof search.invoice === 'string' && UUID_RE.test(search.invoice) ? { invoice: search.invoice } : {},
  component: CheckoutSuccessPage,
});
