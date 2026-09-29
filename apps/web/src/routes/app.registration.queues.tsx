import { Fragment, useState, type ReactNode } from 'react';
import type { CompanyReviewResponse, KycRejectionReason, RegistryDocumentType } from '@arkilaunch/shared';
import {
  cureDocumentsFor,
  hasRequiredCompanyDocuments,
  isPrimaryRegistration,
  KYC_REJECTION_REASON_CODES,
  KYC_REJECTION_REASONS,
  normalizeTin,
  PHILSYS_CHECK_URL,
  PH_ID_TYPES,
  idTypeOf,
  REGISTRY_LINKS,
  TIN_REGEX,
  sameValue,
} from '@arkilaunch/shared';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusBadge } from '../components/status-badge.js';
import { Button } from '../components/button.js';
import { Modal } from '../components/modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { Tabs } from '../components/tabs.js';
import { Alert } from '../components/alert.js';
import { ExpandableSection } from '../components/expandable-section.js';
import { useToast } from '../components/toast.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { companiesQueries } from '../lib/queries.js';
import { formatDate, formatStatus, isUuid } from '../lib/format.js';
import { DOC_LABELS } from '../components/company-card.js';

type ReviewDocument = CompanyReviewResponse['documents'][number];

const ID_DETAILS: { key: string; label: string }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'middle_name', label: 'Middle name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'id_number', label: 'ID number' },
  { key: 'birth_date', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'address', label: 'Address' },
];

// One submitted value, read-only, shown once. When it differs from what
// the upload-time scan read, a quiet "scan: …" hint says so; the score's
// checklist carries the judgement (cr-arkilaunch-registration-scoring.md).
function Submitted({ label, value, scanned }: { label: string; value: string | null | undefined; scanned?: string | undefined }) {
  const differs = Boolean(value && scanned && !sameValue(value, scanned));
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-2 break-words text-text">
        {value || 'Not given'}
        {differs && <span className="text-xs text-text-muted">scan: {scanned}</span>}
      </dd>
    </>
  );
}

const BAND_META = {
  high: { label: 'High', icon: CircleCheck, className: 'text-success' },
  medium: { label: 'Medium', icon: TriangleAlert, className: 'text-warning' },
  low: { label: 'Low', icon: CircleX, className: 'text-error' },
} as const;

const CHECK_META = {
  pass: { icon: CircleCheck, className: 'text-success' },
  warn: { icon: TriangleAlert, className: 'text-warning' },
  fail: { icon: CircleX, className: 'text-error' },
} as const;

// The advisory score as a status indicator; click for the per-check breakdown.
export function ScorePill({ score }: { score: NonNullable<CompanyReviewResponse['score']> }) {
  const [open, setOpen] = useState(false);
  const meta = BAND_META[score.band];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-sm text-text hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Icon aria-hidden className={`h-4 w-4 ${meta.className}`} />
        <span className="font-mono tabular-nums">{score.score}%</span> {meta.label} confidence
        <span className="text-accent underline">{open ? 'Hide checks' : 'Show checks'}</span>
      </button>
      {open && (
        <ul className="flex w-full max-w-md flex-col gap-1 rounded-sm border border-border p-3 text-left text-sm">
          {score.checks.map((c) => {
            const check = CHECK_META[c.status as keyof typeof CHECK_META] ?? CHECK_META.fail;
            const CheckIcon = check.icon;
            return (
              <li key={c.id} className="flex gap-2">
                <CheckIcon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${check.className}`} />
                <span>
                  <span className="font-medium text-text">{c.label}</span>
                  <span className="sr-only"> ({c.status})</span>
                  <span className="block text-xs text-text-muted">{c.reason}</span>
                </span>
              </li>
            );
          })}
          <li className="pt-1 text-xs text-text-muted">Advisory only: you decide.</li>
        </ul>
      )}
    </div>
  );
}

const groupHeading = 'font-medium text-text';
const dlClass = 'grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]';

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
        )}
      </p>
      <Check checked={checked} onChange={onCheckedChange}>
        It is active on the {link.registry} registry
      </Check>
    </div>
  );
}

// A document opens full size; its read confidence rides along, quietly.
function DocButton({ doc, onOpen }: { doc: ReviewDocument; onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      {DOC_LABELS[doc.documentType] ?? formatStatus(doc.documentType)}
      {doc.confidence !== null && (
        <span className={doc.confidence < 0.7 ?'text-error' : 'text-text-muted'}>
          &nbsp;&middot; {Math.round(doc.confidence * 100)}%
        </span>
      )}
    </Button>
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


  const previous = company.rejection;

  return (
    <div role="group" aria-label={company.companyName} className="flex flex-col gap-4">
      {company.score && (
        <div className="flex justify-start">
          <ScorePill score={company.score} />
        </div>
      )}

      {previous && company.kycStatus === 'pending' && (
        <Alert
          type="warning"
          header={`Reapplied after a rejection on ${formatDate(previous.rejectedAt)}: ${KYC_REJECTION_REASONS[previous.reason].label}`}
        >
          {previous.note && <p className="text-text-muted">Your note: {previous.note}</p>}
          {previous.cureDocuments.length > 0 && (
            <p className="text-text-muted">
              Asked for: {previous.cureDocuments.map((t) => DOC_LABELS[t] ?? formatStatus(t)).join(', ')}. Check these first.
            </p>
          )}
        </Alert>
      )}

      {registration?.ocr.layout === 'unrecognized' && (
        <Alert type="warning" header={`The ${DOC_LABELS[registration.documentType] ?? 'registration'} did not read as one.`}>
          It may be the wrong paper, or the page is cut off. Open it before relying on what was read.
        </Alert>
      )}

      <ExpandableSection header="Company" defaultOpen>
        <dl className={dlClass}>
          <Submitted label="Registered name" value={company.companyName} scanned={registration?.ocr.company_name} />
          {(bir || company.tin) && <Submitted label="TIN" value={company.tin} scanned={(bir ?? registration)?.ocr.tin} />}
          {(sec || company.secNumber) && <Submitted label="SEC registration number" value={company.secNumber} scanned={sec?.ocr.sec_number} />}
          {registration?.ocr.registered_address && <Submitted label="Registered address" value={registration.ocr.registered_address} />}
          {registration?.ocr.registration_date && <Submitted label="Registration date" value={registration.ocr.registration_date} />}
          <Submitted label="Billing address" value={company.billingAddress} />
        </dl>
      </ExpandableSection>

      <ExpandableSection header="Contact person">
        <dl className={dlClass}>
          <Submitted
            label="Name"
            value={
              [company.firstName, company.lastName].filter(Boolean).join(' ') ||
              [nationalId?.customer.first_name ?? nationalId?.ocr.first_name, nationalId?.customer.last_name ?? nationalId?.ocr.last_name]
                .filter(Boolean)
                .join(' ')
            }
          />
          <Submitted label="Mobile" value={company.contactPhone ?? null} />
        </dl>
      </ExpandableSection>

      {decidable && (
        <>
          <section aria-labelledby={`reg-${company.id}`} className="flex flex-col gap-3">
            <h3 id={`reg-${company.id}`} className={groupHeading}>
              Business documents
            </h3>
            <div className="flex flex-wrap gap-2">
              {company.documents.length === 0 && <p className="text-sm text-text-muted">No documents uploaded yet.</p>}
              {company.documents
                .filter((doc) => doc.documentType !== 'government_id' && doc.documentType !== 'selfie_with_id')
                .map((doc) => (
                  <DocButton key={doc.id} doc={doc} onOpen={() => onPreviewDocument(company.id, doc.id)} />
                ))}
            </div>
            {dti && (
              <dl className={dlClass}>
                <Submitted label="DTI business name number" value={dtiNumber} scanned={dti.ocr.dti_number} />
              </dl>
            )}
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
            {registryDocs.length > 0 && (
              <p className="text-xs text-text-muted">
                Expired, suspended or not found? Reject with that reason: the customer is told exactly what to bring.
              </p>
            )}
          </section>

          <section aria-labelledby={`id-${company.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`id-${company.id}`} className={groupHeading}>
                ID document
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {[nationalId, selfie]
                .filter((doc): doc is ReviewDocument => Boolean(doc))
                .map((doc) => (
                  <DocButton key={doc.id} doc={doc} onOpen={() => onPreviewDocument(company.id, doc.id)} />
                ))}
            </div>
            {!nationalId && <p className="text-sm text-text-muted">No ID uploaded.</p>}
            {nationalId && (
              <p className="text-sm text-text">
                <span className="text-text-muted">ID type: </span>
                {PH_ID_TYPES[idTypeOf(nationalId.customer.id_type)].label}
              </p>
            )}
            {!selfie && <p className="text-sm text-text-muted">No selfie with the ID uploaded.</p>}
            {nationalId && (
              <ExpandableSection header={<span className="text-sm font-medium">ID details</span>}>
                <dl className={dlClass}>
                  {ID_DETAILS.map(({ key, label }) => (
                    <Fragment key={key}>
                      <Submitted label={label} value={nationalId.customer[key] ?? nationalId.ocr[key]} scanned={nationalId.customer[key] ? nationalId.ocr[key] : undefined} />
                    </Fragment>
                  ))}
                </dl>
              </ExpandableSection>
            )}
            <div className="flex flex-col rounded-md border border-border px-3 py-2">
              {/* philsysVerified is the stored key for "the ID checked out with
                  its issuer" whatever the card (QA 15). */}
              <Check checked={identity.philsysVerified} onChange={(on) => setIdentity({ ...identity, philsysVerified: on })}>
                {idTypeOf(nationalId?.customer.id_type) === 'philsys' ? (
                  <>
                    The ID&apos;s QR code verified on{' '}
                    <a href={PHILSYS_CHECK_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                      PhilSys Check <span aria-hidden="true">↗</span>
                    </a>
                    , and what it returned matches the card.
                  </>
                ) : (
                  <>The ID is genuine, unexpired and checked with its issuer, and its details match the card.</>
                )}
              </Check>
              <Check checked={identity.selfieMatches} onChange={(on) => setIdentity({ ...identity, selfieMatches: on })}>
                The selfie shows the same person as the ID photo, holding this ID.
              </Check>
              <Check checked={identity.holderAuthorized} onChange={(on) => setIdentity({ ...identity, holderAuthorized: on })}>
                The ID holder may act for the company.
              </Check>
              <ExpandableSection header={<span className="text-sm font-medium">How to check these</span>}>
                <ul className="list-disc pl-5 text-sm text-text-muted">
                  <li>{PH_ID_TYPES[idTypeOf(nationalId?.customer.id_type)].verifyHint}</li>
                  <li>
                    The holder may act for the company when listed as an officer on the GIS, named in a Secretary&apos;s
                    Certificate or Board Resolution, or the DTI registrant.
                  </li>
                </ul>
              </ExpandableSection>
            </div>
          </section>

          <div className="sticky -bottom-4 -mx-4 flex flex-col gap-2 border-t border-border bg-surface px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:px-5">
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
                ? 'Waiting on the ID, a selfie holding it, and a BIR 2303 or SEC certificate.'
                : allChecked && identityDone
                  ? 'Verifying approves exactly what the customer submitted.'
                  : 'Check each paper on its registry and tick the three identity checks before verifying.'}
            </p>
          </div>
        </>
      )}
    </div>
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
          <Button variant="ghost" onClick={onClose}>
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
          className="rounded-input border border-border bg-surface px-3 py-2 text-text"
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
  const [asImage, setAsImage] = useState(true);
  const query = useQuery({
    queryKey: ['customers', companyId, 'documents', documentId, 'url'],
    queryFn: () => apiGet<{ url: string }>(`/customers/${companyId}/documents/${documentId}/url`),
  });

  return (
    <Modal open onClose={onClose} title="Document" size="lg">
      {query.isPending && <p className="text-sm text-text-muted">Loading...</p>}
      {query.isError && <Alert type="error">{apiErrorText(query.error)}</Alert>}
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

function scoreText(company: CompanyReviewResponse) {
  return company.score ? `${company.score.score}% · ${BAND_META[company.score.band].label}` : '--';
}

const COLUMNS: TableColumn<CompanyReviewResponse>[] = [
  {
    header: 'Company', kind: 'text',
    cell: (c) => (
      <div className="flex flex-col">
        <span className="font-medium text-text">{c.companyName}</span>
        {c.rejection && c.kycStatus === 'pending' && <span className="text-xs text-text-muted">Reapplied after a rejection</span>}
      </div>
    ),
  },
  { header: 'Applied', kind: 'date', cell: (c) => formatDate(c.createdAt) },
  { header: 'Documents', kind: 'number', cell: (c) => c.documents.length },
  { header: 'Score', kind: 'number', cell: scoreText },
  { header: 'Status', kind: 'status', cell: (c) => <StatusBadge status={c.kycStatus} /> },
];

// The queue as a table; a row opens the full review in a drawer, where the
// reviewer checks the registries and the ID and decides.
function CompanyQueue({ kycStatus }: { kycStatus: 'pending' | 'approved' }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const query = useQuery(companiesQueries.review(kycStatus, PAGE_SIZE, offset));
  // The open review is in the URL (?open=), so Back closes the drawer
  // instead of leaving the queue (QA 17).
  const openId = useSearch({ strict: false }).open ?? null;
  const navigateQueue = useNavigate();
  const setOpenId = (id: string | null) =>
    void navigateQueue({
      to: '.',
      // The router drops an undefined key, which closes the drawer.
      search: ((prev: { open?: string }) => ({ ...prev, open: id ?? undefined })) as never,
    });
  const [preview, setPreview] = useState<{ companyId: string; documentId: string } | null>(null);
  const [rejecting, setRejecting] = useState<CompanyReviewResponse | null>(null);
  const [approving, setApproving] = useState<{ company: CompanyReviewResponse; body: Record<string, unknown> } | null>(null);
  const onPage = query.data?.items.find((c) => c.id === openId) ?? null;
  // ponytail: a deep link past page 1 looks in the first 100 (the API max); GET /customers/review/:id if queues grow.
  const fallback = useQuery({
    ...companiesQueries.review(kycStatus, 100, 0),
    enabled: Boolean(openId) && query.isSuccess && !onPage,
  });
  const open = onPage ?? fallback.data?.items.find((c) => c.id === openId) ?? null;
  const missing = Boolean(openId) && fallback.isSuccess && !open;

  const decide = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPatch(`/customers/${id}/kyc`, body),
    onSuccess: async (_d, { body }) => {
      setRejecting(null);
      setApproving(null);
      setOpenId(null);
      await queryClient.invalidateQueries({ queryKey: ['customers', 'review'] });
      toast.success(body.decision === 'approved' ? 'Company verified' : 'Company rejected', 'The customer has been notified.');
    },
    onError: (err) => toast.error('Could not record the decision', apiErrorText(err)),
  });

  return (
    <div className="flex flex-col gap-3">
      {query.isError && <Alert type="error">{apiErrorText(query.error)}</Alert>}
      {missing && <Alert type="info">That registration is no longer waiting here: it may already be decided.</Alert>}
      <Table
        columns={COLUMNS}
        rows={query.data?.items ?? []}
        rowKey={(c) => c.id}
        onRowClick={(c) => setOpenId(c.id)}
        rowLabel={(c) => `Review ${c.companyName}`}
        empty={
          query.isPending
            ? 'Loading...'
            : kycStatus === 'pending'
              ? 'Nothing waiting. Companies customers add appear here for review.'
              : 'No verified companies yet. Companies you approve appear here.'
        }
        header={{ title: 'Companies', count: query.data?.total ?? 0, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={query.data?.total ?? 0} onOffsetChange={setOffset} noun="companies" busy={query.isFetching} /> }}
      />
      <Modal
        open={open !== null}
        onClose={() => setOpenId(null)}
        placement="right"
        size="lg"
        title={open?.companyName ?? 'Company'}
        {...(open ? { description: `Applied ${formatDate(open.createdAt)}` } : {})}
      >
        {open && (
          <CompanyReviewCard
            key={open.id}
            company={open}
            decidable={kycStatus === 'pending'}
            deciding={decide.isPending}
            onApprove={(registryChecked, identity) =>
              setApproving({ company: open, body: { decision: 'approved', registryChecked, identity } })
            }
            onReject={() => setRejecting(open)}
            onPreviewDocument={(companyId, documentId) => setPreview({ companyId, documentId })}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={approving !== null}
        tone="approve"
        title="Verify this company?"
        body={
          <p>
            <strong>{approving?.company.companyName}</strong> is cleared to book and pay, exactly as submitted. The customer is
            notified.
          </p>
        }
        confirmLabel="Verify company"
        pending={decide.isPending}
        onConfirm={() => {
          if (approving) decide.mutate({ id: approving.company.id, body: approving.body });
        }}
        onCancel={() => setApproving(null)}
      />
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

type Queue = 'pending' | 'approved';
const QUEUE_PATH: Record<Queue, '/app/registration/pending' | '/app/registration/verified'> = {
  pending: '/app/registration/pending',
  approved: '/app/registration/verified',
};

// One page, two tabs: each keeps its own URL so a link to either still works.
function RegistrationsPage({ kycStatus }: { kycStatus: Queue }) {
  const navigate = useNavigate();
  const waiting = useQuery(companiesQueries.review('pending', 1, 0));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Registrations"
        description={
          kycStatus === 'pending'
            ? 'Check what each customer submitted, then verify or reject it.'
            : 'Customer companies cleared to book and pay.'
        }
      />
      <Tabs
        label="Registration status"
        items={[
          { id: 'pending', label: 'Pending', badge: waiting.data?.total ?? null },
          { id: 'approved', label: 'Verified' },
        ]}
        value={kycStatus}
        onChange={(next) => void navigate({ to: QUEUE_PATH[next] })}
      />
      <CompanyQueue key={kycStatus} kycStatus={kycStatus} />
    </div>
  );
}

function queueSearch(search: Record<string, unknown>): { open?: string } {
  return isUuid(search.open) ? { open: search.open } : {};
}

export const appRegistrationPendingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/pending',
  beforeLoad: requireRole('admin'),
  validateSearch: queueSearch,
  component: () => <RegistrationsPage kycStatus="pending" />,
});

export const appRegistrationVerifiedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration/verified',
  beforeLoad: requireRole('admin'),
  validateSearch: queueSearch,
  component: () => <RegistrationsPage kycStatus="approved" />,
});
