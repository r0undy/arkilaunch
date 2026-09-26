import { Link } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasRequiredCompanyDocuments,
  isPrimaryRegistration,
  normalizeTin,
  UNLOCKABLE_COMPANY_FIELDS,
  type CompanyResponse,
} from '@arkilaunch/shared';
import { companiesQueries, customerSitesQueries } from '../lib/queries.js';
import { apiErrorText, apiPatch } from '../lib/api-client.js';
import { Input } from './input.js';
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
};

// The company fields a reviewer can unlock, as the customer reads them.
export const FIELD_LABELS: Record<string, string> = {
  tin: 'TIN',
  secNumber: 'SEC registration number',
  billingAddress: 'Billing address',
};

// Submitted and waiting on the rental team: read-only except whatever the
// reviewer unlocked (customers.service.ts comment()).
export function isWaitingForReview(company: CompanyResponse): boolean {
  return company.kycStatus === 'pending' && hasRequiredCompanyDocuments(company.documents);
}

// The unlocked company fields, and nothing else, for the customer to fix.
function UnlockedFieldsForm({ company, fields }: { company: CompanyResponse; fields: string[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, (company[f as keyof CompanyResponse] as string | null) ?? ''])),
  );
  const save = useMutation({
    mutationFn: () =>
      apiPatch<CompanyResponse>(`/me/companies/${company.id}`, {
        ...values,
        ...(values.tin !== undefined ? { tin: normalizeTin(values.tin) } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: companiesQueries.mine().queryKey });
      toast.success('Sent to the rental team');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {fields.map((f) => (
        <Input
          key={f}
          label={FIELD_LABELS[f] ?? f}
          required
          value={values[f] ?? ''}
          onChange={(e) => setValues({ ...values, [f]: e.target.value })}
        />
      ))}
      <Button type="submit" variant="primary" className="self-start" loading={save.isPending}>
        Save changes
      </Button>
    </form>
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
  const unlockedDocs = company.unlockedFields.filter((f) => f in DOC_LABELS);
  const unlockedFields = company.unlockedFields.filter((f) =>
    (UNLOCKABLE_COMPANY_FIELDS as readonly string[]).includes(f),
  );

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
            {company.reviewComment && (
              <p className="text-text">
                <span className="font-medium">Note from the rental team:</span> {company.reviewComment}
              </p>
            )}
            {unlockedDocs.length > 0 && (
              <p className="text-text-muted">
                Unlocked for you to upload again:{' '}
                {unlockedDocs.map((type) => DOC_LABELS[type]).join(', ')}.{' '}
                <Link
                  to="/account/companies/$companyId/documents"
                  params={{ companyId: company.id }}
                  className="text-accent underline"
                >
                  Upload again
                </Link>
              </p>
            )}
            {unlockedFields.length > 0 && <UnlockedFieldsForm company={company} fields={unlockedFields} />}
          </div>
        )}
        {company.kycStatus === 'rejected' && (
          <div role="status" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
            <p className="font-medium text-text">Verification was declined</p>
            {company.reviewComment && <p className="text-text">{company.reviewComment}</p>}
            <p className="text-text-muted">
              A declined registration cannot be changed.{' '}
              <Link to="/account/companies/new" className="text-accent underline">
                Register the company again
              </Link>{' '}
              with documents that fix the reason, or{' '}
              <Link to="/contact" className="underline">
                contact the rental team
              </Link>
              .
            </p>
          </div>
        )}
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
