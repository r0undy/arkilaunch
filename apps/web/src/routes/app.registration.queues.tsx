import { Fragment, useState } from 'react';
import type { CompanyDecision, CompanyReviewResponse, RegistryDocumentType, RejectionReason } from '@arkilaunch/shared';
import {
  CURE_DOCUMENTS,
  isPrimaryRegistration,
  normalizeTin,
  REGISTRY_LINKS,
  REJECTION_REASON_LABELS,
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

type Decision = CompanyDecision;

// PhilSys's public checker for the signed QR code on the National ID.
const PHILSYS_VERIFY_URL = 'https://verify.philsys.gov.ph/';

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

// A read-only line of what the customer submitted, with what the scan read
// beside it when the two differ. The reviewer never edits these (CR
// pricebook-kyc-weather): a wrong value is a rejection with a reason.
function SubmittedValue({
  label,
  value,
  scanned,
  edited,
}: {
  label: string;
  value: string | null | undefined;
  scanned?: string | undefined;
  edited?: boolean;
}) {
  return (
    <Fragment>
      <dt className="text-text-muted">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 break-words text-text">
        {value || 'Not given'}
        {edited ? <EditedTag scanned={scanned} /> : scanned && value && sameText(scanned, value) ? (
          <span className="text-xs text-text-muted">Matches the scan.</span>
        ) : null}
      </dd>
    </Fragment>
  );
}

// PhilSys's own checker reads the signed QR on the card; the other two are
// the reviewer's comparison of the selfie and the names.
const IDENTITY_CHECKS = [
  {
    key: 'qr',
    label: 'I scanned the PhilSys QR code at verify.philsys.gov.ph and the signed details match the card',
  },
  { key: 'selfie', label: 'The selfie shows the same person holding this ID' },
  {
    key: 'signatory',
    label: 'The ID holder is the owner, officer or authorized signatory named on the SEC/DTI/BIR papers',
  },
] as const;

// The admin-side review of one company: everything the customer submitted,
// read-only, the upload-time scan beside it, the registry and identity
// checks, and Approve or Reject. The extraction decides nothing on its own
// (RFC-2's human gate).
function CompanyReviewCard({
  company,
  decidable,
  onDecide,
  deciding,
  onPreviewDocument,
}: {
  company: CompanyReviewResponse;
  decidable: boolean;
  onDecide: (decision: Decision) => void;
  deciding: boolean;
  onPreviewDocument: (companyId: string, documentId: string) => void;
}) {
  const byType = (type: string) => company.documents.find((doc) => doc.documentType === type);
  const registration = company.documents.find((doc) => isPrimaryRegistration(doc.documentType));
  const nationalId = byType('government_id');
  const selfie = byType('selfie_with_id');
  const sec = byType('sec_certificate');
  const bir = byType('bir_cor');
  const dti = byType('dti_certificate');
  const legacy = byType('company_registration');
  const idValue = (key: string) => nationalId?.customer[key] ?? nationalId?.ocr[key];
  const edited = (doc: ReviewDocument | undefined, key: string) => Boolean(doc && editedKeys(company, doc).includes(key));

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(company.documents.filter((d) => d.registryChecked).map((d) => d.id)),
  );
  const [identity, setIdentity] = useState<Set<string>>(() => new Set());
  const [rejecting, setRejecting] = useState(false);
  const registryDocs = [sec, bir, dti].filter((d): d is ReviewDocument => Boolean(d));
  const allChecked = registryDocs.every((d) => checked.has(d.id));
  const identityDone = IDENTITY_CHECKS.every((c) => identity.has(c.key));
  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const tin = company.tin ?? bir?.ocr.tin ?? '';
  const secNumber = company.secNumber ?? sec?.ocr.sec_number ?? '';
  const dtiNumber = dti?.customer.dti_number ?? dti?.ocr.dti_number ?? '';

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
            {nationalId && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <SubmittedValue label="First name" value={idValue('first_name')} scanned={nationalId.ocr.first_name} edited={edited(nationalId, 'first_name')} />
                <SubmittedValue label="Middle name" value={idValue('middle_name')} scanned={nationalId.ocr.middle_name} edited={edited(nationalId, 'middle_name')} />
                <SubmittedValue label="Last name" value={idValue('last_name')} scanned={nationalId.ocr.last_name} edited={edited(nationalId, 'last_name')} />
                {ID_DETAILS.map(({ key, label }) => (
                  <SubmittedValue key={key} label={label} value={idValue(key)} scanned={nationalId.ocr[key]} edited={edited(nationalId, key)} />
                ))}
              </dl>
            )}
            <p className="text-sm text-text-muted">
              {selfie ? (
                <Button variant="ghost" onClick={() => onPreviewDocument(company.id, selfie.id)}>
                  Open the selfie with ID
                </Button>
              ) : (
                'No selfie with ID uploaded: ask for one by rejecting with "National ID does not match".'
              )}
            </p>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium text-text">Identity checks</legend>
              <a
                href={PHILSYS_VERIFY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline"
              >
                Open the PhilSys verifier <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {IDENTITY_CHECKS.map((c) => (
                <label key={c.key} className="flex min-h-11 items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={identity.has(c.key)}
                    onChange={(e) => setIdentity((cur) => toggle(cur, c.key, e.target.checked))}
                    className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                  />
                  {c.label}
                </label>
              ))}
            </fieldset>
          </section>

          <section aria-labelledby={`reg-${company.id}`} className="flex flex-col gap-3">
            <h3 id={`reg-${company.id}`} className="font-medium text-text">
              Registration
            </h3>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <SubmittedValue label="Registered name" value={company.companyName} scanned={registration?.ocr.company_name} />
              {(bir || legacy || company.tin) && (
                <SubmittedValue label="TIN" value={tin} scanned={(bir ?? legacy)?.ocr.tin} edited={edited(bir ?? legacy, 'tin')} />
              )}
              {(sec || legacy || company.secNumber) && (
                <SubmittedValue label="SEC registration number" value={secNumber} scanned={(sec ?? legacy)?.ocr.sec_number} edited={edited(sec ?? legacy, 'sec_number')} />
              )}
              {dti && <SubmittedValue label="DTI business name number" value={dtiNumber} scanned={dti.ocr.dti_number} edited={edited(dti, 'dti_number')} />}
              {registration?.ocr.registered_address && (
                <SubmittedValue label="Registered address" value={registration.ocr.registered_address} />
              )}
              {registration?.ocr.registration_date && (
                <SubmittedValue label="Registration date" value={registration.ocr.registration_date} />
              )}
            </dl>
            <div className="grid gap-3 sm:grid-cols-3">
              {[bir, sec, dti].map(
                (doc) =>
                  doc && (
                    <RegistryCheck
                      key={doc.id}
                      document={doc}
                      number={doc === bir ? tin : doc === sec ? secNumber : dtiNumber}
                      companyName={company.companyName}
                      checked={checked.has(doc.id)}
                      onCheckedChange={(on) => setChecked((cur) => toggle(cur, doc.id, on))}
                    />
                  ),
              )}
            </div>
            <p className="text-xs text-text-muted">
              Expired 2303, or SEC shows the company suspended, revoked or delinquent? Reject with that reason: the
              customer is told exactly which papers to bring to reapply.
            </p>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="approve"
              loading={deciding}
              disabled={company.documents.length === 0 || !allChecked || !identityDone}
              onClick={() => onDecide({ decision: 'approved', registryChecked: [...checked], identityChecked: true })}
            >
              Approve
            </Button>
            <Button variant="destructive" loading={deciding} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            {allChecked && identityDone
              ? 'Approving verifies the company exactly as the customer submitted it.'
              : 'Tick each registry check and every identity check before approving.'}
          </p>
          <RejectDialog
            open={rejecting}
            companyName={company.companyName}
            pending={deciding}
            onCancel={() => setRejecting(false)}
            onReject={(rejectionReason, rejectionNote) => {
              setRejecting(false);
              onDecide({ decision: 'rejected', rejectionReason, ...(rejectionNote ? { rejectionNote } : {}) });
            }}
          />
        </>
      )}
    </Surface>
  );
}

// A rejection always says why, and the reason decides what the customer
// must upload to reapply (CURE_DOCUMENTS).
function RejectDialog({
  open,
  companyName,
  pending,
  onCancel,
  onReject,
}: {
  open: boolean;
  companyName: string;
  pending: boolean;
  onCancel: () => void;
  onReject: (reason: RejectionReason, note: string) => void;
}) {
  const [reason, setReason] = useState<RejectionReason | ''>('');
  const [note, setNote] = useState('');
  const cure = reason ? CURE_DOCUMENTS[reason] : null;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Reject ${companyName}?`}
      description="The customer is told the reason and which papers to upload to reapply."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" loading={pending} disabled={!reason} onClick={() => reason && onReject(reason, note.trim())}>
            Reject
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as RejectionReason | '')} required>
          <option value="">Choose a reason</option>
          {REJECTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {REJECTION_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
        {cure && (
          <p className="text-sm text-text-muted">
            {cure.required.length === 0
              ? 'Final: the customer cannot reapply with this company.'
              : `To reapply they must upload: ${cure.required.map((t) => DOC_LABELS[t]).join(' or ')}.`}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="reject-note" className="text-sm font-medium text-text">
            Note to the customer (optional)
          </label>
          <textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            className="rounded-md border border-border bg-surface px-3 py-2 text-text"
          />
        </div>
      </div>
    </Modal>
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
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) => apiPatch(`/customers/${id}/kyc`, decision),
    onSuccess: async (_d, { decision: { decision } }) => {
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
          onDecide={(decision) => decide.mutate({ id: company.id, decision })}
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
