import { Link } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CURE_DOCUMENTS,
  hasRequiredCompanyDocuments,
  isPrimaryRegistration,
  REJECTION_REASON_LABELS,
  SUPPORTING_DOCUMENT_TYPES,
  type CompanyResponse,
} from '@arkilaunch/shared';
import { companiesQueries, customerSitesQueries } from '../lib/queries.js';
import { apiErrorText, apiPost, apiPostForm } from '../lib/api-client.js';
import { Select } from './select.js';
import { useToast } from './toast.js';
import { formatStatus } from '../lib/format.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { StatusPill, type StatusTone } from './status-pill.js';
import { AlertIcon, CheckIcon, ClockIcon } from './icons.js';
import { SiteDialog } from './site-dialog.js';

// The full detail of one company: verification state, its KYC documents and
// what is still missing, and the project sites it delivers to. Lifted out of
// account.companies.tsx when the Figma company list (251:1945) moved to
// /account/applications -- the list shows a summary card, this is what
// "Manage" opens.
const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';
export const DOC_LABELS: Record<string, string> = {
  government_id: 'Philippine National ID (PhilSys)',
  bir_cor: 'BIR Certificate of Registration (Form 2303)',
  sec_certificate: 'SEC Certificate of Incorporation',
  dti_certificate: 'DTI Business Name (secondary)',
  company_registration: 'Company registration (legacy)',
  selfie_with_id: 'Selfie holding your National ID',
  bir_1905: 'BIR Form 1905 (registration update)',
  sec_good_standing: 'SEC Certificate of Good Standing / Compliance',
  sec_lifting_order: 'SEC order lifting the suspension or revocation',
  sec_gis: 'Latest SEC General Information Sheet (GIS)',
  business_permit: "Current Mayor's / Business Permit",
  audited_fs: 'Latest BIR-stamped Audited Financial Statements',
};

// Submitted and waiting on the rental team: read-only. The reviewer
// approves or rejects; they never hand fields back for editing.
export function isWaitingForReview(company: CompanyResponse): boolean {
  return company.kycStatus === 'pending' && hasRequiredCompanyDocuments(company.documents);
}

// A rejected company: why, what to upload to prove it is legitimate, and
// Reapply once a required paper is in (customers.service.ts reapply()).
// The ID and 2303/SEC go through the full document page (the ID needs its
// details checked); the supporting papers upload here.
function RejectedCompany({ company }: { company: CompanyResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reason = company.rejectionReason;
  const cure = reason ? CURE_DOCUMENTS[reason] : null;
  const supporting = cure
    ? [...cure.required, ...cure.optional].filter((t) => (SUPPORTING_DOCUMENT_TYPES as readonly string[]).includes(t))
    : [];
  const [docType, setDocType] = useState(supporting[0] ?? '');
  const [file, setFile] = useState<File | null>(null);
  const since = company.rejectedAt ? new Date(company.rejectedAt).getTime() : 0;
  const uploadedSince = (type: string) =>
    company.documents.some((d) => d.documentType === type && new Date(d.createdAt).getTime() > since);
  const cured = cure?.required.some(uploadedSince) ?? false;
  const refresh = () => queryClient.invalidateQueries({ queryKey: companiesQueries.mine().queryKey });

  const upload = useMutation({
    mutationFn: () => apiPostForm(`/me/companies/${company.id}/documents`, { documentType: docType }, file!),
    onSuccess: async () => {
      setFile(null);
      await refresh();
      toast.success('Uploaded');
    },
    onError: (e) => toast.error('Not uploaded', apiErrorText(e)),
  });
  const reapply = useMutation({
    mutationFn: () => apiPost(`/me/companies/${company.id}/reapply`, {}),
    onSuccess: async () => {
      await refresh();
      toast.success('Sent back for review', 'The rental team will check your new documents.');
    },
    onError: (e) => toast.error('Could not reapply', apiErrorText(e)),
  });

  if (!reason || !cure) {
    return (
      <p className="text-text-muted">
        Verification was declined.{' '}
        <Link to="/contact" className="underline">
          Contact the rental team
        </Link>{' '}
        to fix it.
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
      <p className="font-medium text-text">Verification declined: {REJECTION_REASON_LABELS[reason]}</p>
      {company.reviewComment && (
        <p className="text-text">
          <span className="font-medium">Note from the rental team:</span> {company.reviewComment}
        </p>
      )}
      {cure.required.length === 0 ? (
        <p className="text-text-muted">This decision is final for this company.</p>
      ) : (
        <>
          <p className="text-text">To reapply, upload at least one of:</p>
          <ul className="list-disc pl-5 text-text">
            {cure.required.map((t) => (
              <li key={t}>
                {DOC_LABELS[t]} {uploadedSince(t) && <span className="text-text-muted">&middot; uploaded</span>}
              </li>
            ))}
          </ul>
          {cure.optional.length > 0 && (
            <p className="text-text-muted">
              These make your case stronger: {cure.optional.map((t) => DOC_LABELS[t]).join(', ')}.
            </p>
          )}
          <Link
            to="/account/companies/$companyId/documents"
            params={{ companyId: company.id }}
            className="self-start text-accent underline"
          >
            Upload a new National ID, BIR 2303 or SEC certificate
          </Link>
          {supporting.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Supporting document" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {supporting.map((t) => (
                  <option key={t} value={t}>
                    {DOC_LABELS[t]}
                  </option>
                ))}
              </Select>
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                aria-label="File"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="min-h-11 text-sm"
              />
              <Button variant="secondary" disabled={!file || !docType} loading={upload.isPending} onClick={() => upload.mutate()}>
                Upload
              </Button>
            </div>
          )}
          <Button variant="primary" className="self-start" disabled={!cured} loading={reapply.isPending} onClick={() => reapply.mutate()}>
            Reapply for verification
          </Button>
        </>
      )}
    </div>
  );
}

export function VerificationPill({ status }: { status: string }) {
  const meta: Record<string, { tone: StatusTone; label: string; icon: ReactElement }> = {
    approved: { tone: 'recon-approved', label: 'Verified', icon: <CheckIcon /> },
    rejected: { tone: 'recon-failed', label: 'Not verified', icon: <AlertIcon /> },
  };
  const m = meta[status] ?? {
    tone: 'recon-review' as StatusTone,
    label: 'Verification pending',
    icon: <ClockIcon />,
  };
  return <StatusPill tone={m.tone} label={m.label} icon={m.icon} />;
}

export function CompanyCard({ company }: { company: CompanyResponse }) {
  const sites = useQuery(customerSitesQueries.mine());
  const [siteOpen, setSiteOpen] = useState(false);
  const mine = (sites.data ?? []).filter((site) => site.customerId === company.id);
  const has = (test: (type: string) => boolean) => company.documents.some((d) => test(d.documentType));
  const missing = [
    ...(has((t) => t === 'government_id') ? [] : [DOC_LABELS.government_id]),
    ...(has(isPrimaryRegistration) ? [] : ['BIR Form 2303 or SEC certificate']),
  ];
  const waiting = isWaitingForReview(company);

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-text">{company.companyName}</h2>
          <p className="text-sm text-text-muted">
            TIN {company.tin ?? '--'} &middot; {company.billingAddress ?? '--'}
          </p>
        </div>
        <VerificationPill status={company.kycStatus} />
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <h3 className={heading}>Documents</h3>
        {company.documents.map((doc) => (
          <p key={doc.id} className="text-text">
            {DOC_LABELS[doc.documentType] ?? formatStatus(doc.documentType)}{' '}
            <span className="text-text-muted">&middot; {formatStatus(doc.status)}</span>
          </p>
        ))}
        {!waiting && company.kycStatus === 'pending' && missing.length > 0 && (
          <p className="text-text-muted">
            Still needed: {missing.join(', ')}.{' '}
            <Link
              to="/account/companies/$companyId/documents"
              params={{ companyId: company.id }}
              className="text-accent underline"
            >
              Upload
            </Link>
          </p>
        )}
        {waiting && (
          <div role="status" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
            <p className="font-medium text-text">Waiting for admin review</p>
            <p className="text-text-muted">
              The rental team is checking your documents, so they cannot be changed for now. You can
              already request quotes.
            </p>
          </div>
        )}
        {company.kycStatus === 'rejected' && <RejectedCompany company={company} />}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <h3 className={heading}>Project sites</h3>
        {mine.length === 0 && <p className="text-text-muted">No sites yet.</p>}
        {mine.map((site) => (
          <p key={site.id} className="text-text">
            {site.line1}, {site.city}, {site.province}
          </p>
        ))}
        <Button variant="secondary" className="self-start" onClick={() => setSiteOpen(true)}>
          Add a site
        </Button>
      </div>
      <SiteDialog open={siteOpen} onClose={() => setSiteOpen(false)} customerId={company.id} />
    </Surface>
  );
}
