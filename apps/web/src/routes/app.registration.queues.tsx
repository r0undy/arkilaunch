import { Fragment, useState, type ReactNode } from 'react';
import type { CompanyDocumentReadResponse, CompanyReviewResponse, KycRejectionReason, RegistryDocumentType } from '@arkilaunch/shared';
import {
  cureDocumentsFor,
  hasRequiredCompanyDocuments,
  isPrimaryRegistration,
  KYC_REJECTION_REASON_CODES,
  KYC_REJECTION_REASONS,
  normalizeTin,
  PHILSYS_CHECK_URL,
  REGISTRY_LINKS,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { companiesQueries } from '../lib/queries.js';
import { formatDate, formatStatus } from '../lib/format.js';
import { DOC_LABELS } from '../components/company-card.js';

type ReviewDocument = CompanyReviewResponse['documents'][number];

const ID_DETAILS: { key: string; label: string }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'middle_name', label: 'Middle name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'id_number', label: 'PCN' },
  { key: 'birth_date', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'address', label: 'Address' },
];

// "Did the customer change it": a scan and a typed value differ in case,
// spaces and dashes without saying anything different.
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

// One submitted value, read-only, with what the upload-time scan read
// beside it. The reviewer judges it; they never change it.
function Submitted({ label, value, scanned }: { label: string; value: string | null | undefined; scanned?: string | undefined }) {
  const differs = Boolean(value && scanned && !sameValue(value, scanned));
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 break-words text-text">
        {value || 'Not given'}
        {differs ? <EditedTag scanned={scanned} /> : scanned && value && <span className="text-xs text-text-muted">matches the scan</span>}
      </dd>
    </>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-start gap-2 py-1 text-sm text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
      />
      <span>{children}</span>
    </label>
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
        Check {DOC_LABELS[document.documentType] ?? link.registry} on {link.registry} <span aria-hidden="true">↗</span>
        <span className="sr-only"> (opens in a new tab and copies {copy})</span>
      </a>
      <p className="text-xs text-text-muted">
        {link.hint}
        {tinGroups && (
          <>
            {' '}
            TIN boxes: <span className="font-mono text-text">{tinGroups}</span>
          </>
        )}{' '}
        Expired, suspended or not found? Reject with that reason: the customer is told exactly what to bring.
      </p>
      <Check checked={checked} onChange={onCheckedChange}>
        It is active on the {link.registry} registry
      </Check>
    </div>
  );
}

type IdentityChecks = { philsysVerified: boolean; selfieMatches: boolean; holderAuthorized: boolean };
const NO_CHECKS: IdentityChecks = { philsysVerified: false, selfieMatches: false, holderAuthorized: false };

// The admin-side review. Everything the customer submitted is shown
// read-only beside what the upload-time scan read; the reviewer checks it
// against the registries and the ID, then approves or rejects with a
// reason. The extraction decides nothing (RFC-2's human gate).
function CompanyReviewCard({
  company,
  decidable,
  onApprove,
  onReject,
  deciding,
  onPreviewDocument,
}: {
  company: CompanyReviewResponse;
  decidable: boolean;
  onApprove: (registryChecked: string[], identity: IdentityChecks) => void;
  onReject: () => void;
  deciding: boolean;
  onPreviewDocument: (companyId: string, documentId: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const byType = (type: string) => company.documents.find((doc) => doc.documentType === type);
  const registration = company.documents.find((doc) => isPrimaryRegistration(doc.documentType));
  const nationalId = byType('government_id');
  const selfie = byType('selfie_with_id');
  const sec = byType('sec_certificate');
  const bir = byType('bir_cor');
  const dti = byType('dti_certificate');
  const dtiNumber = dti?.customer.dti_number ?? dti?.ocr.dti_number ?? '';

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(company.documents.filter((d) => d.registryChecked).map((d) => d.id)),
  );
  const [identity, setIdentity] = useState<IdentityChecks>(NO_CHECKS);
  const registryDocs = [sec, bir, dti].filter((d): d is ReviewDocument => Boolean(d));
  const complete = hasRequiredCompanyDocuments(company.documents);
  const allChecked = registryDocs.every((d) => checked.has(d.id));
  const identityDone = identity.philsysVerified && identity.selfieMatches && identity.holderAuthorized;
  const setCheck = (id: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // A fresh OCR pass, as evidence beside what the customer typed.
  const readDocument = useMutation({
    mutationFn: (documentId: string) =>
      apiPost<CompanyDocumentReadResponse>(`/customers/${company.id}/documents/${documentId}/read`, {}),
    onSuccess: async (result) => {
      if (!result.extractionAvailable) {
        toast.error('Could not read the document', 'Document extraction is not switched on in this environment.');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['customers', 'review'] });
    },
    onError: (err) => toast.error('Could not read the document', apiErrorText(err)),
  });
  const reread = (doc: ReviewDocument | undefined, label: string) =>
    doc && (
      <Button variant="ghost" loading={readDocument.isPending && readDocument.variables === doc.id} onClick={() => readDocument.mutate(doc.id)}>
        Re-read {label}
      </Button>
    );

  const previous = company.rejection;

  return (
    <Surface radius="md" elevation="sm" role="group" aria-label={company.companyName} className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-text">{company.companyName}</h2>
        <p className="text-sm text-text-muted">
          {company.billingAddress ?? '--'} &middot; added {formatDate(company.createdAt)}
        </p>
      </div>

      {previous && company.kycStatus === 'pending' && (
        <div role="note" className="rounded-md border border-warning px-3 py-2 text-sm">
          <p className="font-medium text-text">
            Reapplied after a rejection on {formatDate(previous.rejectedAt)}: {KYC_REJECTION_REASONS[previous.reason].label}
          </p>
          {previous.note && <p className="text-text-muted">Your note: {previous.note}</p>}
          {previous.cureDocuments.length > 0 && (
            <p className="text-text-muted">
              Asked for: {previous.cureDocuments.map((t) => DOC_LABELS[t] ?? formatStatus(t)).join(', ')}. Check these first.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {company.documents.length === 0 && <p className="text-sm text-text-muted">No documents uploaded yet.</p>}
        {company.documents.map((doc) => (
          <Button key={doc.id} variant="secondary" onClick={() => onPreviewDocument(company.id, doc.id)}>
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
          <section aria-labelledby={`reg-${company.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`reg-${company.id}`} className="font-medium text-text">
                Registration, as submitted
              </h3>
              {reread(registration, 'registration')}
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <Submitted label="Registered name" value={company.companyName} scanned={registration?.ocr.company_name} />
              {(bir || company.tin) && <Submitted label="TIN" value={company.tin} scanned={(bir ?? registration)?.ocr.tin} />}
              {(sec || company.secNumber) && <Submitted label="SEC registration number" value={company.secNumber} scanned={sec?.ocr.sec_number} />}
              {dti && <Submitted label="DTI business name number" value={dtiNumber} scanned={dti.ocr.dti_number} />}
              {registration?.ocr.registered_address && <Submitted label="Registered address" value={registration.ocr.registered_address} />}
              {registration?.ocr.registration_date && <Submitted label="Registration date" value={registration.ocr.registration_date} />}
            </dl>
            <div className="grid gap-3 sm:grid-cols-3">
              {registryDocs.map((doc) => (
                <RegistryCheck
                  key={doc.id}
                  document={doc}
                  number={doc === bir ? (company.tin ?? '') : doc === sec ? (company.secNumber ?? '') : dtiNumber}
                  companyName={company.companyName}
                  checked={checked.has(doc.id)}
                  onCheckedChange={(on) => setCheck(doc.id, on)}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby={`id-${company.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`id-${company.id}`} className="font-medium text-text">
                Identity
              </h3>
              {reread(nationalId, 'National ID')}
            </div>
            {!nationalId && <p className="text-sm text-text-muted">No National ID uploaded.</p>}
            {!selfie && <p className="text-sm text-text-muted">No selfie with the ID uploaded.</p>}
            {nationalId && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {ID_DETAILS.map(({ key, label }) => (
                  <Fragment key={key}>
                    <Submitted label={label} value={nationalId.customer[key] ?? nationalId.ocr[key]} scanned={nationalId.customer[key] ? nationalId.ocr[key] : undefined} />
                  </Fragment>
                ))}
              </dl>
            )}
            <div className="flex flex-col rounded-md border border-border px-3 py-2">
              <Check checked={identity.philsysVerified} onChange={(on) => setIdentity({ ...identity, philsysVerified: on })}>
                The ID&apos;s QR code verified on{' '}
                <a href={PHILSYS_CHECK_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                  PhilSys Check <span aria-hidden="true">↗</span>
                </a>
                , and the name, birth date and photo it returned match the card.{' '}
                <span className="text-text-muted">
                  Open the ID photo and scan its QR with PhilSys Check. The QR is signed by the PSA, so a printed card, an edited
                  photo or a borrowed ID will not match.
                </span>
              </Check>
              <Check checked={identity.selfieMatches} onChange={(on) => setIdentity({ ...identity, selfieMatches: on })}>
                The selfie shows the same person as the ID photo, holding this ID.
              </Check>
              <Check checked={identity.holderAuthorized} onChange={(on) => setIdentity({ ...identity, holderAuthorized: on })}>
                The ID holder may act for the company: listed as an officer on the GIS, named in a Secretary&apos;s Certificate or
                Board Resolution, or the DTI registrant.
              </Check>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="approve"
              loading={deciding}
              disabled={!complete || !allChecked || !identityDone}
              onClick={() => onApprove([...checked], identity)}
            >
              Verify
            </Button>
            <Button variant="destructive" loading={deciding} onClick={onReject}>
              Reject
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            {!complete
              ? 'Waiting on the National ID, a selfie holding it, and a BIR 2303 or SEC certificate.'
              : allChecked && identityDone
                ? 'Verifying approves exactly what the customer submitted.'
                : 'Check each paper on its registry and tick the three identity checks before verifying.'}
          </p>
        </>
      )}
    </Surface>
  );
}

// A rejection is final for this submission, so it carries a reason: the
// customer is told what went wrong and which papers cure it, and reapplies
// with them. "Unreadable" asks the reviewer to name the documents.
function RejectDialog({
  company,
  pending,
  onClose,
  onConfirm,
}: {
  company: CompanyReviewResponse;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: KycRejectionReason, note: string, extra: string[]) => void;
}) {
  const [reason, setReason] = useState<KycRejectionReason | null>(null);
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const cure = reason ? cureDocumentsFor(reason, [...extra]) : [];
  const onFile = [...new Set(company.documents.map((d) => d.documentType))];
  const needsPick = reason === 'document_unreadable' && cure.length === 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reject ${company.companyName}?`}
      description="The customer sees the reason and the documents that fix it, then reapplies. Nothing they submitted is changed."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={pending}
            disabled={!reason || needsPick}
            onClick={() => reason && onConfirm(reason, note.trim(), [...extra])}
          >
            Reject
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-text">Reason</legend>
        {KYC_REJECTION_REASON_CODES.map((code) => (
          <label key={code} className="flex min-h-11 items-start gap-2 py-1 text-sm">
            <input
              type="radio"
              name={`reason-${company.id}`}
              checked={reason === code}
              onChange={() => setReason(code)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              <span className="font-medium text-text">{KYC_REJECTION_REASONS[code].label}</span>
              <span className="block text-text-muted">{KYC_REJECTION_REASONS[code].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {reason === 'document_unreadable' && (
        <fieldset className="mt-3 flex flex-col gap-1">
          <legend className="text-sm font-medium text-text">Which documents to upload again</legend>
          {onFile.map((type) => (
            <label key={type} className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={extra.has(type)}
                onChange={(e) =>
                  setExtra((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(type);
                    else next.delete(type);
                    return next;
                  })
                }
                className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
              />
              {DOC_LABELS[type] ?? formatStatus(type)}
            </label>
          ))}
        </fieldset>
      )}
      {reason && (
        <div className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
          <p className="font-medium text-text">{KYC_REJECTION_REASONS[reason].final ? 'Final: the customer cannot reapply.' : 'The customer is asked for:'}</p>
          {cure.length > 0 && <p className="text-text">{cure.map((t) => DOC_LABELS[t] ?? formatStatus(t)).join(', ')}</p>}
          <p className="text-text-muted">{KYC_REJECTION_REASONS[reason].customer}</p>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor={`note-${company.id}`} className="text-sm font-medium text-text">
          Note to the customer (optional)
        </label>
        <textarea
          id={`note-${company.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="What you saw, e.g. Check with SEC lists the company as suspended."
          className="rounded-md border border-border bg-surface px-3 py-2 text-text"
        />
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
  const [rejecting, setRejecting] = useState<CompanyReviewResponse | null>(null);

  const decide = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPatch(`/customers/${id}/kyc`, body),
    onSuccess: async (_d, { body }) => {
      setRejecting(null);
      await queryClient.invalidateQueries({ queryKey: ['customers', 'review'] });
      toast.success(body.decision === 'approved' ? 'Company verified' : 'Company rejected', 'The customer has been notified.');
    },
    onError: (err) => toast.error('Could not record the decision', apiErrorText(err)),
  });

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
        <CompanyReviewCard
          key={company.id}
          company={company}
          decidable={kycStatus === 'pending'}
          deciding={decide.isPending}
          onApprove={(registryChecked, identity) =>
            decide.mutate({ id: company.id, body: { decision: 'approved', registryChecked, identity } })
          }
          onReject={() => setRejecting(company)}
          onPreviewDocument={(companyId, documentId) => setPreview({ companyId, documentId })}
        />
      ))}
      {rejecting && (
        <RejectDialog
          company={rejecting}
          pending={decide.isPending}
          onClose={() => setRejecting(null)}
          onConfirm={(reason, note, extra) =>
            decide.mutate({
              id: rejecting.id,
              body: { decision: 'rejected', reason, ...(note ? { note } : {}), cureDocuments: extra },
            })
          }
        />
      )}
      {preview && (
        <DocumentPreviewModal companyId={preview.companyId} documentId={preview.documentId} onClose={() => setPreview(null)} />
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
        description="Approve or reject what each customer submitted. You check it; you never edit it. A rejection tells the customer which documents fix it, and they reapply."
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
      <PageHeader eyebrow="Registration" title="Registration verified" description="Customer companies cleared to pay." />
      <CompanyQueue kycStatus="approved" />
    </div>
  ),
});
