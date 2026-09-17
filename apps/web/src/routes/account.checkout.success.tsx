import { createRoute, Link } from '@tanstack/react-router';
import { accountLayoutRoute } from './_account.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon } from '../components/icons.js';

// Figma 168:3376 "Bank Transfer Successful". This is the PayMongo hosted
// checkout return target (PRD §5.2 deep-link entry points), so it is
// deliberately a terminal confirmation with no payment state of its own:
// the authority on whether money moved is the payment webhook, not this
// page. It therefore confirms the handoff completed and points at the
// booking, rather than asserting "paid".
function CheckoutSuccessPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Checkout" title="Payment submitted" />
      <Surface radius="md" elevation="sm" className="flex flex-col items-start gap-4 p-6">
        <StatusPill tone="recon-approved" label="Submitted" icon={<CheckIcon />} />
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-xl font-semibold text-text">
            Thanks -- we have your payment instruction.
          </h2>
          <p className="max-w-prose text-sm text-text-muted">
            Your booking stays pending until the funds clear and our billing team confirms them.
            That confirmation usually lands the same working day for online payments, and on the
            next working day for an over-the-counter deposit. You will see the booking move to
            confirmed on this account, and the receipt appears against the booking&rsquo;s invoice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/account/bookings">
            <Button variant="primary">View my bookings</Button>
          </Link>
          <Link to="/equipment">
            <Button variant="secondary">Browse equipment</Button>
          </Link>
        </div>
      </Surface>
    </div>
  );
}

export const accountCheckoutSuccessRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/checkout/success',
  component: CheckoutSuccessPage,
});
