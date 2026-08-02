import { createRoute, Link } from '@tanstack/react-router';
import { authLayoutRoute } from './_auth.js';
import { Surface } from '../components/surface.js';
import { StatusPill } from '../components/status-pill.js';
import { AlertIcon } from '../components/icons.js';

function AdminApprovalPage() {
  return (
    <Surface radius="lg" elevation="md" className="flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
      <StatusPill tone="recon-review" label="Pending admin approval" icon={<AlertIcon />} />
      <h1 className="font-display text-xl font-semibold text-text">Application submitted</h1>
      <p className="text-sm text-text-muted">
        We are verifying your company details against SEC and BIR records. This is a human review step and may
        take a few business days. We will email you once it is confirmed.
      </p>
      <Link to="/login" className="text-sm font-semibold text-accent hover:underline">
        Back to sign in
      </Link>
    </Surface>
  );
}

export const registerPendingRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/register/pending',
  component: AdminApprovalPage,
});
