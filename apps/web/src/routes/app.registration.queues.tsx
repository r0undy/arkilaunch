import { Fragment, useState, type ReactNode } from 'react';
import type {
  CompanyDecision,
  CompanyReviewResponse,
  RegistryDocumentType,
  RejectionReason,
} from '@arkilaunch/shared';
import {
  DTI_REGEX,
  isPrimaryRegistration,
  normalizeTin,
  REGISTRY_LINKS,
  SEC_REGEX,
  REJECTION_REASON_CODES,
  REJECTION_REASONS,
  TIN_REGEX,
} from '@arkilaunch/shared';
import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { useToast } from '../components/toast.js';
import { Select } from '../components/select.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { companiesQueries } from '../lib/queries.js';
import { formatDate, formatStatus } from '../lib/format.js';
import { DOC_LABELS } from '../components/company-card.js';

type ReviewDocument = CompanyReviewResponse['documents'][number];

const ID_DETAILS: { key: string; label: string }[] = [
  { key: 'id_number', label: 'PCN' },
  { key: 'birth_date', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'address', label: 'Address' },
];

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Looser, for "did the customer change it": a scan and a typed value differ
// in case, spaces and dashes without saying anything different.
const sameValue = (a: string, b: string) =>
  a.replace(/[^a-z0-9]/gi, '').toLowerCase() === b.replace(/[^a-z0-9]/gi, '').toLowerCase();

// The port keys on this paper where what the customer entered (confirmed at
// upload, or the TIN / SEC number on the company) differs from the scan.
// For those the scan's read % says nothing about the value in front of the
// reviewer, so it is replaced by an "Edited by customer" tag.
function editedKeys(company: CompanyReviewResponse, doc: ReviewDocument): string[] {
  const entered: Record<string, string> = {
    ...(company.tin ? { tin: company.tin } : {}),
    ...(company.secNumber ? { sec_number: company.secNumber } : {}),
    ...doc.customer,
  };
  return Object.keys(entered).filter((key) => doc.ocr[key] && !sameValue(entered[key]!, doc.ocr[key]!));
}

function EditedTag({ scanned }: { scanned?: string | undefined }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      <span className="rounded-sm border border-warning px-1.5 text-text">Edited by customer</span>
      {scanned !== undefined && <span className="text-text-muted">scan read "{scanned}"</span>}
    </span>
  );
}

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

// One value the customer submitted, shown read-only: the reviewer judges
// it against the document and the registry, and never edits it.
function SubmittedField({
  label,
  value,
  hint,
  error,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  error?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-muted">{label}</span>
      <span className="min-h-11 break-words rounded-sm border border-border px-3.5 py-3 text-base text-text">
        {value.trim() || 'Not given'}
      </span>
      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : (
        hint && <div className="text-sm text-text-muted">{hint}</div>
      )}
    </div>
  );
}

// The admin-side counterpart to the customer's scan. The card shows what
// the customer submitted beside what the upload-time scan read, read-only:
// the reviewer checks it against the documents and the public registries,
// then verifies or rejects. There is no edit and no hand-back for a
// re-upload; a rejection names a reason, and the customer registers anew
// with the documents that cure it (RFC-2's human gate).
function CompanyReviewCard({
  company,
  decidable,
  onDecide,
  deciding,
  onPreviewDocument,
}: {
  company: CompanyReviewResponse;
  decidable: boolean;
  onDecide: (body: CompanyDecision) => void;
  deciding: boolean;
  onPreviewDocument: (companyId: string, documentId: string) => void;
}) {
  const byType = (type: string) => company.documents.find((doc) => doc.documentType === type);
  const registration = company.documents.find((doc) => isPrimaryRegistration(doc.documentType));
  const nationalId = byType('government_id');
  const sec = byType('sec_certificate');
  const bir = byType('bir_cor');
  const dti = byType('dti_certificate');
  const legacy = byType('company_registration');
  const idValue = (key: string) => nationalId?.customer[key] ?? nationalId?.ocr[key] ?? '';
  const fieldHint = (doc: ReviewDocument | undefined, key: string, current: string) =>
    doc && editedKeys(company, doc).includes(key) ? (
      <EditedTag scanned={doc.ocr[key]} />
    ) : (
      scanHint(doc?.ocr[key], current)
    );

  const fields = {
    companyName: company.companyName,
    tin: company.tin ?? bir?.ocr.tin ?? '',
    secNumber: company.secNumber ?? sec?.ocr.sec_number ?? '',
    dtiNumber: dti?.customer.dti_number ?? dti?.ocr.dti_number ?? '',
  };
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(company.documents.filter((d) => d.registryChecked).map((d) => d.id)),
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectionReason | ''>('');
  const [note, setNote] = useState('');
  const registryDocs = [sec, bir, dti].filter((d): d is ReviewDocument => Boolean(d));
  const allChecked = registryDocs.every((d) => checked.has(d.id));
  const setCheck = (id: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const rejectReady = reason !== '' && (reason !== 'other' || note.trim() !== '');

  const nameField = (label: string, key: string) => (
    <SubmittedField label={label} value={idValue(key)} hint={fieldHint(nationalId, key, idValue(key))} />
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
            {editedKeys(company, doc).length > 0 ? (
              <>
                &nbsp;&middot;&nbsp;
                <EditedTag />
              </>
            ) : (
              doc.confidence !== null && (
                <span className={doc.confidence < 0.85 ? 'text-error' : 'text-text-muted'}>
                  &nbsp;&middot; {Math.round(doc.confidence * 100)}%
                </span>
              )
            )}
          </Button>
        ))}
      </div>

      {decidable && (
        <>
          <section aria-labelledby={`id-${company.id}`} className="flex flex-col gap-3">
            <h3 id={`id-${company.id}`} className="font-medium text-text">
              National ID
            </h3>
            {!nationalId && <p className="text-sm text-text-muted">No National ID uploaded.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              {nameField('First name', 'first_name')}
              {nameField('Middle name', 'middle_name')}
              {nameField('Last name', 'last_name')}
            </div>
            {nationalId && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {ID_DETAILS.map(({ key, label }) => {
                  const customer = nationalId.customer[key];
                  const scanned = nationalId.ocr[key];
                  const edited = editedKeys(company, nationalId).includes(key);
                  return (
                    <Fragment key={key}>
                      <dt className="text-text-muted">{label}</dt>
                      <dd className="flex flex-wrap items-center gap-2 break-words text-text">
                        {customer ?? scanned ?? 'Not read'}
                        {edited && <EditedTag scanned={scanned} />}
                      </dd>
                    </Fragment>
                  );
                })}
              </dl>
            )}
            <p className="text-xs text-text-muted">
              Compare the name, PCN and photo against the ID image, and scan its QR with the PhilSys
              verifier. The name is written onto the customer's account only when you verify.
            </p>
          </section>

          <section aria-labelledby={`reg-${company.id}`} className="flex flex-col gap-3">
            <h3 id={`reg-${company.id}`} className="font-medium text-text">
              Registration
            </h3>
            <SubmittedField
              label="Registered name"
              value={fields.companyName}
              hint={scanHint(registration?.ocr.company_name, fields.companyName)}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {(bir || legacy || company.tin) && (
                <div className="flex flex-col gap-1">
                  <SubmittedField
                    label="TIN"
                    value={fields.tin}
                    hint={fieldHint(bir ?? legacy, 'tin', fields.tin)}
                    error={formatError(normalizeTin(fields.tin), TIN_REGEX, 'Not a 9 or 12 digit TIN.')}
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
                  <SubmittedField
                    label="SEC registration number"
                    value={fields.secNumber}
                    hint={fieldHint(sec ?? legacy, 'sec_number', fields.secNumber)}
                    error={formatError(fields.secNumber, SEC_REGEX, 'Not an SEC registration number format.')}
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
                  <SubmittedField
                    label="DTI business name number"
                    value={fields.dtiNumber}
                    hint={fieldHint(dti, 'dti_number', fields.dtiNumber)}
                    error={formatError(fields.dtiNumber, DTI_REGEX, 'Not a DTI business name number format.')}
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

          {rejecting && (
            <section aria-labelledby={`reject-${company.id}`} className="flex flex-col gap-3">
              <h3 id={`reject-${company.id}`} className="font-medium text-text">
                Why are you rejecting?
              </h3>
              <Select
                label="Reason"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value as RejectionReason | '')}
                hint={reason ? `The customer is told to bring: ${REJECTION_REASONS[reason].cure}` : undefined}
              >
                <option value="">Choose a reason</option>
                {REJECTION_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {REJECTION_REASONS[code].label}
                  </option>
                ))}
              </Select>
              <div className="flex flex-col gap-1">
                <label htmlFor={`reject-note-${company.id}`} className="text-sm font-medium text-text">
                  Note to the customer{reason === 'other' ? ' *' : ' (optional)'}
                </label>
                <textarea
                  id={`reject-note-${company.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-text"
                />
              </div>
              <p className="text-xs text-text-muted">
                Rejection is final for this registration. The customer registers the company again with
                documents that cure the reason.
              </p>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            {!rejecting && (
              <Button
                variant="approve"
                loading={deciding}
                disabled={company.documents.length === 0 || !allChecked}
                onClick={() => onDecide({ decision: 'approved', registryChecked: [...checked] })}
              >
                Verify
              </Button>
            )}
            <Button
              variant="destructive"
              loading={deciding}
              disabled={rejecting && !rejectReady}
              onClick={() =>
                rejecting && reason
                  ? onDecide({
                      decision: 'rejected',
                      rejectionReason: reason,
                      ...(note.trim() ? { rejectionNote: note.trim() } : {}),
                    })
                  : setRejecting(true)
              }
            >
              {rejecting ? 'Confirm rejection' : 'Reject'}
            </Button>
            {rejecting && (
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            )}
          </div>
          {!rejecting && (
            <p className="text-xs text-text-muted">
              {allChecked
                ? 'Verifying accepts what the customer submitted, as shown.'
                : 'Check each number on its registry and tick it before verifying.'}
            </p>
          )}
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
    mutationFn: ({ id, body }: { id: string; body: CompanyDecision }) =>
      apiPatch(`/customers/${id}/kyc`, body),
    onSuccess: async (_d, { body: { decision } }) => {
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
          onDecide={(body) => decide.mutate({ id: company.id, body })}
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
  beforeLoad: requireRole('admin'),
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
  beforeLoad: requireRole('admin'),
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
