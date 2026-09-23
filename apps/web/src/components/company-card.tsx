import { Link } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompanyResponse } from '@arkilaunch/shared';
import { customerSitesQueries } from '../lib/queries.js';
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
  company_registration: 'Company registration',
};

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
  // A document that came back too blurry to read needs the same "upload
  // it again" prompt as one never uploaded at all.
  const missing = Object.keys(DOC_LABELS).filter(
    (type) =>
      !company.documents.some(
        (doc) => doc.documentType === type && doc.status !== 'resubmit_required',
      ),
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
        {missing.length > 0 && (
          <p className="text-text-muted">
            Still needed: {missing.map((type) => DOC_LABELS[type]).join(', ')}.{' '}
            <Link
              to="/account/companies/$companyId/documents"
              params={{ companyId: company.id }}
              className="text-accent underline"
            >
              Upload
            </Link>
          </p>
        )}
        {company.kycStatus === 'pending' && missing.length === 0 && (
          <p className="text-text-muted">
            The rental team is checking your documents. You can already request quotes.
          </p>
        )}
        {company.kycStatus === 'rejected' && (
          <p className="text-text-muted">
            Verification was declined.{' '}
            <Link to="/contact" className="underline">
              Contact the rental team
            </Link>{' '}
            to fix it.
          </p>
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
