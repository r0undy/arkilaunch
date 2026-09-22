import { createRoute, Link } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';
import { Surface } from '../components/surface.js';
import { useToast } from '../components/toast.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { companiesQueries } from '../lib/queries.js';
import { formatDate, formatStatus } from '../lib/format.js';

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

// Customer prerequisites CR: companies customers registered, with the ID
// and registration they uploaded. Staff open each document (a 300s signed
// URL) and decide; the customer is notified, and payment opens on approval.
function CompanyQueue({ kycStatus }: { kycStatus: 'pending' | 'approved' }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery(companiesQueries.review(kycStatus));

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      apiPatch(`/customers/${id}/kyc`, { decision }),
    onSuccess: async (_d, { decision }) => {
      await queryClient.invalidateQueries({ queryKey: ['customers', 'review'] });
      toast.success(decision === 'approved' ? 'Company verified' : 'Company rejected', 'The customer has been notified.');
    },
    onError: (err) => toast.error('Could not record the decision', apiErrorText(err)),
  });

  async function openDocument(companyId: string, documentId: string) {
    // Open the tab synchronously so the popup blocker allows it, then
    // point it at the signed URL once it arrives.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await apiGet<{ url: string }>(`/customers/${companyId}/documents/${documentId}/url`);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      toast.error('Could not open the document', apiErrorText(err));
    }
  }

  if (query.isPending) return <p className="text-sm text-text-muted">Loading...</p>;
  if (query.isError) return <p className="text-sm text-error">{apiErrorText(query.error)}</p>;
  if (query.data.length === 0) {
    return (
      <EmptyState
        title={kycStatus === 'pending' ? 'Nothing waiting' : 'No verified companies yet'}
        description={kycStatus === 'pending' ? 'Companies customers add appear here for review.' : 'Companies you approve appear here.'}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {query.data.map((company) => (
        <Surface key={company.id} radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-text">{company.companyName}</h2>
            <p className="text-sm text-text-muted">
              TIN {company.tin ?? '--'} &middot; {company.billingAddress ?? '--'} &middot; added {formatDate(company.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {company.documents.length === 0 && <p className="text-sm text-text-muted">No documents uploaded yet.</p>}
            {company.documents.map((doc) => (
              <Button key={doc.id} variant="secondary" onClick={() => openDocument(company.id, doc.id)}>
                {formatStatus(doc.documentType)}
              </Button>
            ))}
          </div>
          {kycStatus === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="approve"
                loading={decide.isPending}
                disabled={company.documents.length === 0}
                onClick={() => decide.mutate({ id: company.id, decision: 'approved' })}
              >
                Verify
              </Button>
              <Button variant="destructive" loading={decide.isPending} onClick={() => decide.mutate({ id: company.id, decision: 'rejected' })}>
                Reject
              </Button>
            </div>
          )}
        </Surface>
      ))}
    </div>
  );
}

export const appRegistrationPendingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/pending',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: () => (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Registration" title="Registration pending" description="Customer companies waiting on a verification decision." />
      <CompanyQueue kycStatus="pending" />
    </div>
  ),
});

export const appRegistrationVerifiedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/verified',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: () => (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Registration" title="Registration verified" description="Customer companies cleared to pay." />
      <CompanyQueue kycStatus="approved" />
    </div>
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
