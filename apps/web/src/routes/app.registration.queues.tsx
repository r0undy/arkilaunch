import { useState } from 'react';
import type { CompanyDocumentReadResponse, CompanyResponse } from '@arkilaunch/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';
import { Surface } from '../components/surface.js';
import { useToast } from '../components/toast.js';
import { Input } from '../components/input.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
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

// What a reviewer typed (or confirmed) for one company, keyed by company id
// so several cards in the queue keep their own edits.
interface ReviewFields {
  companyName: string;
  tin: string;
  secNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
}

// The admin-side counterpart to the customer's scan: "Read document" fills
// these fields in from the registration certificate, the reviewer corrects
// whatever is wrong, and Verify writes what they confirmed. The extraction
// decides nothing on its own -- it is a typing aid for the person who is
// looking at the document (RFC-2's human gate).
function CompanyReviewCard({
  company,
  decidable,
  onDecide,
  deciding,
  onOpenDocument,
}: {
  company: CompanyResponse;
  decidable: boolean;
  onDecide: (fields: ReviewFields, decision: 'approved' | 'rejected') => void;
  deciding: boolean;
  onOpenDocument: (companyId: string, documentId: string) => void;
}) {
  const toast = useToast();
  const [fields, setFields] = useState<ReviewFields>({
    companyName: company.companyName,
    tin: company.tin ?? '',
    secNumber: '',
    firstName: company.firstName ?? '',
    middleName: company.middleName ?? '',
    lastName: company.lastName ?? '',
  });
  const [read, setRead] = useState<CompanyDocumentReadResponse | null>(null);

  const registration = company.documents.find((doc) => doc.documentType === 'company_registration');
  const nationalId = company.documents.find((doc) => doc.documentType === 'government_id');

  const readDocument = useMutation({
    mutationFn: (documentId: string) =>
      apiPost<CompanyDocumentReadResponse>(
        `/customers/${company.id}/documents/${documentId}/read`,
        {},
      ),
    onSuccess: (result) => {
      setRead(result);
      if (!result.extractionAvailable) {
        toast.error(
          'Could not read the document',
          'Document extraction is not switched on in this environment. Key the details in from the document instead.',
        );
        return;
      }
      setFields((current) => ({
        companyName: result.suggestions.companyName ?? current.companyName,
        tin: result.suggestions.tin ?? current.tin,
        secNumber: result.suggestions.secNumber ?? current.secNumber,
        firstName: result.suggestions.firstName ?? current.firstName,
        middleName: result.suggestions.middleName ?? current.middleName,
        lastName: result.suggestions.lastName ?? current.lastName,
      }));
    },
    onError: (err) => toast.error('Could not read the document', apiErrorText(err)),
  });

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-text">{company.companyName}</h2>
        <p className="text-sm text-text-muted">
          TIN {company.tin ?? '--'} &middot; {company.billingAddress ?? '--'} &middot; added{' '}
          {formatDate(company.createdAt)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {company.documents.length === 0 && (
          <p className="text-sm text-text-muted">No documents uploaded yet.</p>
        )}
        {company.documents.map((doc) => (
          <Button
            key={doc.id}
            variant="secondary"
            onClick={() => onOpenDocument(company.id, doc.id)}
          >
            {formatStatus(doc.documentType)}
          </Button>
        ))}
      </div>

      {decidable && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!registration}
              loading={readDocument.isPending}
              onClick={() => registration && readDocument.mutate(registration.id)}
            >
              Read registration
            </Button>
            <Button
              variant="secondary"
              disabled={!nationalId}
              loading={readDocument.isPending}
              onClick={() => nationalId && readDocument.mutate(nationalId.id)}
            >
              Read National ID
            </Button>
            <p className="text-sm text-text-muted">
              Fills the fields below in from whichever document you read. Check them against the
              document before verifying.
            </p>
          </div>

          {read?.extractionAvailable && (
            <p role="status" className="text-sm text-text-muted">
              Read at{' '}
              {read.confidence === null ? 'unknown' : `${Math.round(read.confidence * 100)}%`}{' '}
              confidence.
              {read.suggestions.tin &&
                !read.formatValid.tin &&
                ' The TIN is not a valid 9 or 12 digit number.'}
              {read.suggestions.secNumber &&
                !read.formatValid.secNumber &&
                ' The SEC number does not match the expected format.'}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Registered name"
              maxLength={200}
              value={fields.companyName}
              onChange={(e) => setFields({ ...fields, companyName: e.target.value })}
            />
            <Input
              label="TIN"
              inputMode="numeric"
              placeholder="000-000-000-000"
              hint="9 or 12 digits."
              value={fields.tin}
              onChange={(e) => setFields({ ...fields, tin: e.target.value })}
            />
            <Input
              label="SEC / DTI number"
              maxLength={50}
              value={fields.secNumber}
              onChange={(e) => setFields({ ...fields, secNumber: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="First name"
              maxLength={200}
              hint="From the National ID. Written onto the customer's account only when you verify."
              value={fields.firstName}
              onChange={(e) => setFields({ ...fields, firstName: e.target.value })}
            />
            <Input
              label="Middle name"
              maxLength={200}
              value={fields.middleName}
              onChange={(e) => setFields({ ...fields, middleName: e.target.value })}
            />
            <Input
              label="Last name"
              maxLength={200}
              value={fields.lastName}
              onChange={(e) => setFields({ ...fields, lastName: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="approve"
              loading={deciding}
              disabled={company.documents.length === 0}
              onClick={() => onDecide(fields, 'approved')}
            >
              Verify
            </Button>
            <Button
              variant="destructive"
              loading={deciding}
              onClick={() => onDecide(fields, 'rejected')}
            >
              Reject
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Verifying saves these fields onto the company. They are your confirmation against the
            document, not the scan's.
          </p>
        </>
      )}
    </Surface>
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
    mutationFn: ({
      id,
      decision,
      fields,
    }: {
      id: string;
      decision: 'approved' | 'rejected';
      fields: ReviewFields;
    }) =>
      apiPatch(`/customers/${id}/kyc`, {
        decision,
        // Only what the reviewer actually filled in; the API keeps whatever
        // the customer entered for anything left blank.
        ...(fields.companyName.trim() ? { companyName: fields.companyName.trim() } : {}),
        ...(fields.tin.trim() ? { tin: fields.tin.trim() } : {}),
        ...(fields.secNumber.trim() ? { secNumber: fields.secNumber.trim() } : {}),
        ...(fields.firstName.trim() ? { firstName: fields.firstName.trim() } : {}),
        ...(fields.middleName.trim() ? { middleName: fields.middleName.trim() } : {}),
        ...(fields.lastName.trim() ? { lastName: fields.lastName.trim() } : {}),
      }),
    onSuccess: async (_d, { decision }) => {
      await queryClient.invalidateQueries({ queryKey: ['customers', 'review'] });
      toast.success(
        decision === 'approved' ? 'Company verified' : 'Company rejected',
        'The customer has been notified.',
      );
    },
    onError: (err) => toast.error('Could not record the decision', apiErrorText(err)),
  });

  async function openDocument(companyId: string, documentId: string) {
    // Open the tab synchronously so the popup blocker allows it, then
    // point it at the signed URL once it arrives.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await apiGet<{ url: string }>(
        `/customers/${companyId}/documents/${documentId}/url`,
      );
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
        description={
          kycStatus === 'pending'
            ? 'Companies customers add appear here for review.'
            : 'Companies you approve appear here.'
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {query.data.map((company) => (
        <CompanyReviewCard
          key={company.id}
          company={company}
          decidable={kycStatus === 'pending'}
          deciding={decide.isPending}
          onDecide={(fields, decision) => decide.mutate({ id: company.id, decision, fields })}
          onOpenDocument={openDocument}
        />
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
      <PageHeader
        eyebrow="Registration"
        title="Registration pending"
        description="Customer companies waiting on a verification decision."
      />
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
      <PageHeader
        eyebrow="Registration"
        title="Registration verified"
        description="Customer companies cleared to pay."
      />
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
