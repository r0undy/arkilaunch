import { createRoute, Link } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';

// Figma models registration as three admin queues -- Registration Pendings
// (282:7320), Registration Verified (282:7784) and Registration Review
// (349:942) -- on top of the submission flow at /app/registration.
//
// None of the three has a query behind it. The KYC API is
// POST /kyc/extract, GET /kyc/:id and POST /kyc/:id/confirm: a document is
// readable only by its own id, and nothing lists documents by tenant or by
// state. A queue screen with no list endpoint can only show invented rows,
// so these three name the gap instead and point at the flow that does work.
// Wiring them needs a KYC list endpoint and its own Change Record; the gap
// is recorded in docs/report-figma-route-alignment.md §5.
function RegistrationQueue({
  title,
  description,
  gap,
}: {
  title: string;
  description: string;
  gap: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Registration" title={title} description={description} />
      <EmptyState
        title="This queue has no list endpoint yet"
        description={gap}
        action={
          <Link to="/app/registration">
            <Button variant="primary">Open the registration flow</Button>
          </Link>
        }
      />
    </div>
  );
}

export const appRegistrationPendingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/pending',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: () => (
    <RegistrationQueue
      title="Registration pending"
      description="Submitted documents waiting on a verification decision."
      gap="KYC documents are read one at a time by document id (GET /kyc/:id). Nothing lists the documents still awaiting a decision, so this queue cannot be populated without inventing its rows."
    />
  ),
});

export const appRegistrationVerifiedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/verified',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: () => (
    <RegistrationQueue
      title="Registration verified"
      description="Users whose documents cleared verification."
      gap="Verification is recorded by POST /kyc/:id/confirm, but no endpoint reads the verified set back. Until one exists this list would be fabricated."
    />
  ),
});

export const appRegistrationReviewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/review',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: () => (
    <RegistrationQueue
      title="Registration review"
      description="Extracted SEC and TIN values checked against the registry."
      gap="The review screen needs a document to review and there is no queue to pick one from. Submitting a document and stepping through extraction and confirmation already works on the registration flow, which is where a reviewer can do this today."
    />
  ),
});
