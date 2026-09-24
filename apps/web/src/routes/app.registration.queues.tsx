import { Fragment, useState } from 'react';
import type { CompanyDocumentReadResponse, CompanyReviewResponse, RegistryDocumentType } from '@arkilaunch/shared';
import {
  DTI_REGEX,
  isPrimaryRegistration,
  normalizeTin,
  REGISTRY_LINKS,
  SEC_REGEX,
  TIN_REGEX,
} from '@arkilaunch/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { useToast } from '../components/toast.js';
import { Input } from '../components/input.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { companiesQueries } from '../lib/queries.js';
import { formatDate, formatStatus } from '../lib/format.js';
import { DOC_LABELS } from '../components/company-card.js';

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
  dtiNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
}

type ReviewDocument = CompanyReviewResponse['documents'][number];

const ID_DETAILS: { key: string; label: string }[] = [
  { key: 'id_number', label: 'PCN' },
  { key: 'birth_date', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'address', label: 'Address' },
];

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Under each field: what the upload-time scan read, so a reviewer sees at a
// glance whether the customer's value matches the paper.
function scanHint(scanned: string | undefined, current: string): string | undefined {
  if (!scanned) return undefined;
  return sameText(scanned, current) ? 'Matches the scan.' : `Scan read "${scanned}".`;
}

function formatError(value: string, re: RegExp, message: string): string | undefined {
  return value.trim() && !re.test(value.trim()) ? message : undefined;
}

// The public-registry check for one paper: the link copies whatever that
// registry takes as a paste (REGISTRY_LINKS) and opens its search in a new
// tab; the tick records that the reviewer actually looked.
function RegistryCheck({
  document,
  number,
  companyName,
  checked,
  onCheckedChange,
}: {
  document: ReviewDocument;
  number: string;
  companyName: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const toast = useToast();
  const link = REGISTRY_LINKS[document.documentType as RegistryDocumentType];
  const copy = (link.copy === 'name' ? companyName : number).trim();
  // ORUS takes the TIN as three separate boxes, so show it that way.
  const tin = normalizeTin(number);
  const tinGroups =
    document.documentType === 'bir_cor' && TIN_REGEX.test(tin) ? tin.split('-').slice(0, 3).join(' | ') : null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline"
        onClick={() => {
          if (!copy) return;
          navigator.clipboard?.writeText(copy).then(
            () => toast.success(`Copied ${copy}`, link.hint),
            () => undefined,
          );
        }}
      >
        Check on {link.registry} <span aria-hidden="true">↗</span>
        <span className="sr-only"> (opens in a new tab and copies {copy})</span>
      </a>
      <p className="text-xs text-text-muted">
        {link.hint}
        {tinGroups && (
          <>
            {' '}
            TIN boxes: <span className="font-mono text-text">{tinGroups}</span>
          </>
        )}
      </p>
      <label className="flex min-h-11 items-center gap-2 text-text">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
        />
        I checked this on the {link.registry} registry
      </label>
    </div>
  );
}

// The admin-side counterpart to the customer's scan. The card opens with
// what the customer confirmed and what the upload-time scan read, side by
// side, with no click; "Re-read" runs a fresh pass. The extraction decides
// nothing on its own -- it is a typing aid for the person looking at the
// document, and Verify waits on their registry checks (RFC-2's human gate).
function CompanyReviewCard({
  company,
  decidable,
  onDecide,
  deciding,
  onPreviewDocument,
}: {
  company: CompanyReviewResponse;
  decidable: boolean;
  onDecide: (fields: ReviewFields, decision: 'approved' | 'rejected', registryChecked: string[]) => void;
  deciding: boolean;
  onPreviewDocument: (companyId: string, documentId: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const byType = (type: string) => company.documents.find((doc) => doc.documentType === type);
  const registration = company.documents.find((doc) => isPrimaryRegistration(doc.documentType));
  const nationalId = byType('government_id');
  const sec = byType('sec_certificate');
  const bir = byType('bir_cor');
  const dti = byType('dti_certificate');
  const legacy = byType('company_registration');
  const idValue = (key: string) => nationalId?.customer[key] ?? nationalId?.ocr[key] ?? '';

  const [fields, setFields] = useState<ReviewFields>({
    companyName: company.companyName,
    tin: company.tin ?? bir?.ocr.tin ?? '',
    secNumber: company.secNumber ?? sec?.ocr.sec_number ?? '',
    dtiNumber: dti?.customer.dti_number ?? dti?.ocr.dti_number ?? '',
    firstName: company.firstName ?? idValue('first_name'),
    middleName: company.middleName ?? idValue('middle_name'),
    lastName: company.lastName ?? idValue('last_name'),
  });
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(company.documents.filter((d) => d.registryChecked).map((d) => d.id)),
  );
  const registryDocs = [sec, bir, dti].filter((d): d is ReviewDocument => Boolean(d));
  const allChecked = registryDocs.every((d) => checked.has(d.id));
  const setCheck = (id: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const readDocument = useMutation({
    mutationFn: (documentId: string) =>
      apiPost<CompanyDocumentReadResponse>(
        `/customers/${company.id}/documents/${documentId}/read`,
        {},
      ),
    onSuccess: async (result) => {
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
        dtiNumber: result.suggestions.dtiNumber ?? current.dtiNumber,
        firstName: result.suggestions.firstName ?? current.firstName,
        middleName: result.suggestions.middleName ?? current.middleName,
        lastName: result.suggestions.lastName ?? current.lastName,
      }));
      await queryClient.invalidateQueries({ queryKey: ['customers', 'review'] });
    },
    onError: (err) => toast.error('Could not read the document', apiErrorText(err)),
  });

  const nameField = (key: 'firstName' | 'middleName' | 'lastName', label: string, ocrKey: string) => (
    <Input
      label={label}
      maxLength={200}
      hint={scanHint(nationalId?.ocr[ocrKey], fields[key])}
      value={fields[key]}
      onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
    />
  );

  return (
    <Surface
      radius="md"
      elevation="sm"
      role="group"
      aria-label={company.companyName}
      className="flex flex-col gap-4 p-5"
    >
      <div>
        <h2 className="font-display text-lg font-semibold text-text">{company.companyName}</h2>
        <p className="text-sm text-text-muted">
          {company.billingAddress ?? '--'} &middot; added {formatDate(company.createdAt)}
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
            onClick={() => onPreviewDocument(company.id, doc.id)}
          >
            {DOC_LABELS[doc.documentType] ?? formatStatus(doc.documentType)}
            {doc.confidence !== null && (
              <span className={doc.confidence < 0.85 ? 'text-error' : 'text-text-muted'}>
                &nbsp;&middot; {Math.round(doc.confidence * 100)}%
              </span>
            )}
          </Button>
        ))}
      </div>

      {decidable && (
        <>
          <section aria-labelledby={`id-${company.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`id-${company.id}`} className="font-medium text-text">
                National ID
              </h3>
              {nationalId && (
                <Button
                  variant="ghost"
                  loading={readDocument.isPending && readDocument.variables === nationalId.id}
                  onClick={() => readDocument.mutate(nationalId.id)}
                >
                  Re-read National ID
                </Button>
              )}
            </div>
            {!nationalId && <p className="text-sm text-text-muted">No National ID uploaded.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              {nameField('firstName', 'First name', 'first_name')}
              {nameField('middleName', 'Middle name', 'middle_name')}
              {nameField('lastName', 'Last name', 'last_name')}
            </div>
            {nationalId && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {ID_DETAILS.map(({ key, label }) => {
                  const customer = nationalId.customer[key];
                  const scanned = nationalId.ocr[key];
                  const edited = customer && scanned && !sameText(customer, scanned);
                  return (
                    <Fragment key={key}>
                      <dt className="text-text-muted">{label}</dt>
                      <dd className="break-words text-text">
                        {customer ?? scanned ?? 'Not read'}
                        {edited && (
                          <span className="ml-2 inline-block rounded-sm border border-warning px-1.5 text-xs text-text">
                            customer edited, scan read "{scanned}"
                          </span>
                        )}
                      </dd>
                    </Fragment>
                  );
                })}
              </dl>
            )}
            <p className="text-xs text-text-muted">
              The name is written onto the customer's account only when you verify.
            </p>
          </section>

          <section aria-labelledby={`reg-${company.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`reg-${company.id}`} className="font-medium text-text">
                Registration
              </h3>
              {registration && (
                <Button
                  variant="ghost"
                  loading={readDocument.isPending && readDocument.variables === registration.id}
                  onClick={() => readDocument.mutate(registration.id)}
                >
                  Re-read registration
                </Button>
              )}
            </div>
            <Input
              label="Registered name"
              maxLength={200}
              hint={scanHint(registration?.ocr.company_name, fields.companyName)}
              value={fields.companyName}
              onChange={(e) => setFields({ ...fields, companyName: e.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {(bir || legacy || company.tin) && (
                <div className="flex flex-col gap-1">
                  <Input
                    label="TIN"
                    inputMode="numeric"
                    placeholder="000-000-000-000"
                    hint={scanHint((bir ?? legacy)?.ocr.tin, fields.tin)}
                    error={formatError(normalizeTin(fields.tin), TIN_REGEX, 'Not a 9 or 12 digit TIN.')}
                    value={fields.tin}
                    onChange={(e) => setFields({ ...fields, tin: e.target.value })}
                  />
                  {bir && (
                    <RegistryCheck
                      document={bir}
                      number={fields.tin}
                      companyName={fields.companyName}
                      checked={checked.has(bir.id)}
                      onCheckedChange={(on) => setCheck(bir.id, on)}
                    />
                  )}
                </div>
              )}
              {(sec || legacy || company.secNumber) && (
                <div className="flex flex-col gap-1">
                  <Input
                    label="SEC registration number"
                    maxLength={50}
                    hint={scanHint((sec ?? legacy)?.ocr.sec_number, fields.secNumber)}
                    error={formatError(fields.secNumber, SEC_REGEX, 'Not an SEC registration number format.')}
                    value={fields.secNumber}
                    onChange={(e) => setFields({ ...fields, secNumber: e.target.value })}
                  />
                  {sec && (
                    <RegistryCheck
                      document={sec}
                      number={fields.secNumber}
                      companyName={fields.companyName}
                      checked={checked.has(sec.id)}
                      onCheckedChange={(on) => setCheck(sec.id, on)}
                    />
                  )}
                </div>
              )}
              {dti && (
                <div className="flex flex-col gap-1">
                  <Input
                    label="DTI business name number"
                    maxLength={50}
                    hint={scanHint(dti.ocr.dti_number, fields.dtiNumber)}
                    error={formatError(fields.dtiNumber, DTI_REGEX, 'Not a DTI business name number format.')}
                    value={fields.dtiNumber}
                    onChange={(e) => setFields({ ...fields, dtiNumber: e.target.value })}
                  />
                  <RegistryCheck
                    document={dti}
                    number={fields.dtiNumber}
                    companyName={fields.companyName}
                    checked={checked.has(dti.id)}
                    onCheckedChange={(on) => setCheck(dti.id, on)}
                  />
                </div>
              )}
            </div>
            {(registration?.ocr.registered_address || registration?.ocr.registration_date) && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-text-muted">Registered address</dt>
                <dd className="break-words text-text">{registration.ocr.registered_address ?? 'Not read'}</dd>
                <dt className="text-text-muted">Registration date</dt>
                <dd className="text-text">{registration.ocr.registration_date ?? 'Not read'}</dd>
              </dl>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="approve"
              loading={deciding}
              disabled={company.documents.length === 0 || !allChecked}
              onClick={() => onDecide(fields, 'approved', [...checked])}
            >
              Verify
            </Button>
            <Button
              variant="destructive"
              loading={deciding}
              onClick={() => onDecide(fields, 'rejected', [])}
            >
              Reject
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            {allChecked
              ? 'Verifying saves these fields onto the company. They are your confirmation against the document, not the scan\'s.'
              : 'Check each number on its registry and tick it before verifying.'}
          </p>
        </>
      )}
    </Surface>
  );
}

// Customer prerequisites CR: companies customers registered, with the ID
// and registration they uploaded. Staff open each document (a 300s signed
// URL) and decide; the customer is notified, and payment opens on approval.
function DocumentPreviewModal({
  companyId,
  documentId,
  onClose,
}: {
  companyId: string;
  documentId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [asImage, setAsImage] = useState(true);
  const query = useQuery({
    queryKey: ['customers', companyId, 'documents', documentId, 'url'],
    queryFn: () => apiGet<{ url: string }>(`/customers/${companyId}/documents/${documentId}/url`),
  });

  if (query.isError) toast.error('Could not open the document', apiErrorText(query.error));

  return (
    <Modal open onClose={onClose} title="Document" size="lg">
      {query.isPending && <p className="text-sm text-text-muted">Loading...</p>}
      {query.isError && <p className="text-sm text-error">{apiErrorText(query.error)}</p>}
      {query.data &&
        (asImage ? (
          <img
            src={query.data.url}
            alt="Uploaded document"
            className="mx-auto max-h-[70vh] w-auto max-w-full rounded-sm"
            onError={() => setAsImage(false)}
          />
        ) : (
          <iframe
            src={query.data.url}
            title="Uploaded document"
            className="h-[70vh] w-full rounded-sm border border-border"
          />
        ))}
      {query.data && (
        <a
          href={query.data.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm text-primary underline"
        >
          Open in a new tab
        </a>
      )}
    </Modal>
  );
}

function CompanyQueue({ kycStatus }: { kycStatus: 'pending' | 'approved' }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery(companiesQueries.review(kycStatus));
  const [preview, setPreview] = useState<{ companyId: string; documentId: string } | null>(null);

  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
      fields,
      registryChecked,
    }: {
      id: string;
      decision: 'approved' | 'rejected';
      fields: ReviewFields;
      registryChecked: string[];
    }) =>
      apiPatch(`/customers/${id}/kyc`, {
        decision,
        // Only what the reviewer actually filled in; the API keeps whatever
        // the customer entered for anything left blank.
        ...(fields.companyName.trim() ? { companyName: fields.companyName.trim() } : {}),
        ...(fields.tin.trim() ? { tin: normalizeTin(fields.tin) } : {}),
        ...(fields.secNumber.trim() ? { secNumber: fields.secNumber.trim() } : {}),
        ...(fields.dtiNumber.trim() ? { dtiNumber: fields.dtiNumber.trim() } : {}),
        ...(registryChecked.length > 0 ? { registryChecked } : {}),
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
          onDecide={(fields, decision, registryChecked) =>
            decide.mutate({ id: company.id, decision, fields, registryChecked })
          }
          onPreviewDocument={(companyId, documentId) => setPreview({ companyId, documentId })}
        />
      ))}
      {preview && (
        <DocumentPreviewModal
          companyId={preview.companyId}
          documentId={preview.documentId}
          onClose={() => setPreview(null)}
        />
      )}
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
