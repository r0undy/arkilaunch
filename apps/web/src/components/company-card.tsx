import { Link } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasRequiredCompanyDocuments,
  isPrimaryRegistration,
  KYC_REJECTION_REASONS,
  type CompanyResponse,
} from '@arkilaunch/shared';
import { companiesQueries, customerSitesQueries } from '../lib/queries.js';
import { apiErrorText, apiPost, apiPostForm } from '../lib/api-client.js';
import { useToast } from './toast.js';
import { describeUploadProblem, prepareUpload, UploadPrepareError } from '../lib/image-compression.js';
import { formatStatus } from '../lib/format.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { StatusPill, type StatusTone } from './status-pill.js';
import { Check, Clock, TriangleAlert } from 'lucide-react';
import { SiteDialog } from './site-dialog.js';
import { SiteProofStatus } from './site-proof.js';

const heading = 'text-heading-md text-text';
export const DOC_LABELS: Record<string, string> = {
  government_id: 'Government-issued ID',
  selfie_with_id: 'Selfie holding your ID (no longer needed)',
  bir_cor: 'BIR Certificate of Registration (Form 2303)',
  sec_certificate: 'SEC Certificate of Incorporation',
  dti_certificate: 'DTI Business Name (secondary)',
  company_registration: 'Company registration (legacy)',
  business_permit: "Mayor's or Business Permit (current year)",
  sec_good_standing: 'SEC order lifting the suspension, or Certificate of Good Standing',
  sec_gis: 'Latest General Information Sheet (GIS), SEC-stamped',
  secretary_certificate: "Secretary's Certificate or Board Resolution naming you",
};

export function isWaitingForReview(company: CompanyResponse): boolean {
  return company.kycStatus === 'pending' && hasRequiredCompanyDocuments(company.documents);
}

export function registrationNumber(company: CompanyResponse): { label: string; value: string } | null {
  const has = (type: string) => company.documents.some((d) => d.documentType === type);
  if (company.tin && (has('bir_cor') || !company.secNumber)) return { label: 'TIN', value: company.tin };
  if (company.secNumber) return { label: 'SEC reg. no.', value: company.secNumber };
  return null;
}

export function missingDocuments(company: CompanyResponse): string[] {
  const has = (test: (type: string) => boolean) => company.documents.some((d) => test(d.documentType));
  return [
    ...(has((t) => t === 'government_id') ? [] : [DOC_LABELS.government_id!]),
    ...(has(isPrimaryRegistration) ? [] : ['BIR Form 2303 or SEC certificate']),
  ];
}

export function companyRemark(company: CompanyResponse): { text: string; action?: 'upload' | 'fix' } {
  if (company.kycStatus === 'approved') return { text: 'Verified: you can book and pay under this company.' };
  if (company.kycStatus === 'rejected') {
    const reason = company.rejection ? KYC_REJECTION_REASONS[company.rejection.reason] : null;
    const label = reason ? `Not verified: ${reason.label}.` : 'Verification was declined.';
    return company.rejection && !company.rejection.final ? { text: `${label} Fix it and reapply.`, action: 'fix' } : { text: label };
  }
  const missing = missingDocuments(company);
  if (missing.length > 0) return { text: `Still needed: ${missing.join(', ')}.`, action: 'upload' };
  return { text: "Under review: the rental team is checking your documents. We'll notify you when it's done." };
}

function DocumentUpload({ company, documentType, done }: { company: CompanyResponse; documentType: string; done: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const upload = useMutation({
    // Default options: Azure DI reads these bytes for KYC.
    mutationFn: async (file: File) =>
      apiPostForm(`/me/companies/${company.id}/documents`, { documentType }, await prepareUpload(file)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: companiesQueries.mine().queryKey });
      toast.success('Uploaded', DOC_LABELS[documentType]);
    },
    onError: (e) => {
      const { title, detail } = e instanceof UploadPrepareError ? describeUploadProblem(e) : { title: 'Not uploaded', detail: apiErrorText(e) };
      toast.error(title, detail);
    },
  });
  const id = `upload-${company.id}-${documentType}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span className="text-text">
        {DOC_LABELS[documentType] ?? formatStatus(documentType)}
        {done && <span className="text-text-muted"> &middot; uploaded</span>}
      </span>
      <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center font-medium text-accent underline">
        {upload.isPending ? 'Uploading...' : done ? 'Replace' : 'Upload'}
        <input
          id={id}
          type="file"
          className="sr-only"
          accept="image/*,application/pdf"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function RejectionPanel({ company }: { company: CompanyResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const rejection = company.rejection;
  const reapply = useMutation({
    mutationFn: () => apiPost<CompanyResponse>(`/me/companies/${company.id}/reapply`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: companiesQueries.mine().queryKey });
      toast.success('Sent back for review', 'The rental team will check your new documents.');
    },
    onError: (e) => toast.error('Not sent', apiErrorText(e)),
  });
  if (!rejection) {
    return (
      <p className="text-text-muted">
        Verification was declined.{' '}
        <Link to="/contact" className="underline">
          Contact the rental team
        </Link>
        .
      </p>
    );
  }
  const reason = KYC_REJECTION_REASONS[rejection.reason];
  const uploadedSince = (type: string) =>
    company.documents.some((d) => d.documentType === type && new Date(d.createdAt) > new Date(rejection.rejectedAt));
  const ready = rejection.cureDocuments.every(uploadedSince);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-error px-3 py-2">
      <p className="font-medium text-text">Not verified: {reason.label}</p>
      {rejection.note && (
        <p className="text-text">
          <span className="font-medium">From the rental team:</span> {rejection.note}
        </p>
      )}
      <p className="text-text-muted">{reason.customer}</p>
      {!rejection.final && (
        <>
          {rejection.cureDocuments.map((type) => (
            <DocumentUpload key={type} company={company} documentType={type} done={uploadedSince(type)} />
          ))}
          <Button variant="primary" className="self-start" disabled={!ready} loading={reapply.isPending} onClick={() => reapply.mutate()}>
            Reapply for verification
          </Button>
          {!ready && <p className="text-xs text-text-muted">Upload each document above to reapply.</p>}
        </>
      )}
    </div>
  );
}

export function VerificationPill({ status }: { status: string }) {
  const meta: Record<string, { tone: StatusTone; label: string; icon: ReactElement }> = {
    approved: { tone: 'recon-approved', label: 'Verified', icon: <Check className="size-full" /> },
    rejected: { tone: 'recon-failed', label: 'Not verified', icon: <TriangleAlert className="size-full" /> },
  };
  const m = meta[status] ?? {
    tone: 'recon-review' as StatusTone,
    label: 'Verification pending',
    icon: <Clock className="size-full" />,
  };
  return <StatusPill tone={m.tone} label={m.label} icon={m.icon} />;
}

export function CompanyCard({ company }: { company: CompanyResponse }) {
  const sites = useQuery(customerSitesQueries.mine());
  const [siteOpen, setSiteOpen] = useState(false);
  const mine = (sites.data ?? []).filter((site) => site.customerId === company.id);
  const missing = missingDocuments(company);
  const waiting = isWaitingForReview(company);

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-heading-md text-text">{company.companyName}</h2>
          <p className="text-sm text-text-muted">
            {registrationNumber(company)
              ? `${registrationNumber(company)!.label} ${registrationNumber(company)!.value}`
              : 'No registration number yet'}{' '}
            &middot; {company.billingAddress ?? '--'}
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
              The rental team is checking your documents, so they cannot be changed for now. They will
              verify the company or tell you exactly what to fix. You can already request quotes.
            </p>
          </div>
        )}
        {company.kycStatus === 'rejected' && <RejectionPanel company={company} />}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <h3 className={heading}>Project sites</h3>
        {mine.length === 0 && <p className="text-text-muted">No sites yet.</p>}
        {mine.map((site) => (
          <div key={site.id} className="flex flex-col gap-1">
            <p className="text-text">
              {site.line1}, {site.city}, {site.province}
            </p>
            <SiteProofStatus site={site} />
          </div>
        ))}
        <Button variant="secondary" className="self-start" onClick={() => setSiteOpen(true)}>
          Add a site
        </Button>
      </div>
      <SiteDialog open={siteOpen} onClose={() => setSiteOpen(false)} customerId={company.id} />
    </Surface>
  );
}
