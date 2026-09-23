import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyResponse, KycScanResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { apiErrorText, apiPost, apiPostForm } from '../lib/api-client.js';
import { companiesQueries, customerSitesQueries } from '../lib/queries.js';
import { formatStatus } from '../lib/format.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { EmptyState } from '../components/empty-state.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { AlertIcon, CheckIcon, ClockIcon } from '../components/icons.js';
import { CaptureField } from '../components/capture-field.js';
import { Skeleton } from '../components/skeleton.js';
import { SiteDialog } from '../components/site-dialog.js';
import { useToast } from '../components/toast.js';

const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';
const DOC_LABELS: Record<string, string> = {
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

function CompanyCard({ company }: { company: CompanyResponse }) {
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

function CompaniesPage() {
  const companies = useQuery(companiesQueries.mine());
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My account"
        title="Companies"
        description="The businesses you rent for, their verification, and where you deliver."
        actions={
          <Link to="/account/companies/new">
            <Button variant="primary">Add a company</Button>
          </Link>
        }
      />
      {companies.isPending && <Skeleton label="Loading your companies" rows={2} />}
      {companies.isError && <p className="text-sm text-error">{apiErrorText(companies.error)}</p>}
      {companies.data?.length === 0 && (
        <EmptyState
          title="Add your company first"
          description="We need the company you are renting for before a booking: its TIN, billing address, an ID and its registration."
          action={
            <Link to="/account/companies/new">
              <Button variant="primary">Add a company</Button>
            </Link>
          }
        />
      )}
      {companies.data?.map((company) => (
        <CompanyCard key={company.id} company={company} />
      ))}
    </div>
  );
}

// Upload both documents, one request each. Shared by the new-company form
// and the "upload what is still missing" screen.
async function uploadDocuments(
  companyId: string,
  files: { governmentId: File | null; registration: File | null },
): Promise<string[]> {
  // Each upload is screened by OCR server-side; an illegible scan comes
  // back 'resubmit_required' instead of 'pending', named here so the
  // customer is told immediately rather than finding out from the queue.
  const bounced: string[] = [];
  if (files.governmentId) {
    const doc = await apiPostForm<{ documentType: string; status: string }>(
      `/me/companies/${companyId}/documents`,
      { documentType: 'government_id' },
      files.governmentId,
    );
    if (doc.status === 'resubmit_required') bounced.push(DOC_LABELS[doc.documentType]!);
  }
  if (files.registration) {
    const doc = await apiPostForm<{ documentType: string; status: string }>(
      `/me/companies/${companyId}/documents`,
      { documentType: 'company_registration' },
      files.registration,
    );
    if (doc.status === 'resubmit_required') bounced.push(DOC_LABELS[doc.documentType]!);
  }
  return bounced;
}

// One document at a time, in order. Both used to sit on the same screen,
// which asked a customer to frame two different papers at once; the ID is
// the gate, the registration follows it.
export type DocStep = 'government_id' | 'company_registration';

export const DOC_STEPS: { type: DocStep; label: string; hint: string }[] = [
  {
    type: 'government_id',
    label: 'Philippine National ID (PhilSys)',
    hint: 'Step 1 of 2. Only the PhilSys National ID is accepted -- it is how we read and confirm your legal name.',
  },
  {
    type: 'company_registration',
    label: 'Company registration (SEC or DTI)',
    hint: 'Step 2 of 2. The certificate that shows the registered name and number.',
  },
];

function DocumentStep({
  step,
  value,
  onChange,
}: {
  step: (typeof DOC_STEPS)[number];
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">{step.hint}</p>
      <CaptureField
        id={`doc-${step.type}`}
        label={step.label}
        accept="image/*,application/pdf"
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

// Reads the registration the customer just captured and hands back what it
// saw, for them to correct on the form. A failed or unavailable scan is not
// an error the customer has to act on -- the form simply opens empty.
async function scanForSuggestions(file: File): Promise<KycScanResponse['suggestions'] | null> {
  try {
    const scan = await apiPostForm<KycScanResponse>('/me/kyc/scan', {}, file);
    return scan.extractionAvailable ? scan.suggestions : null;
  } catch {
    return null;
  }
}

// Figma 582:3946 / 168:2442 "Add New Company".
function NewCompanyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState('');
  const [tin, setTin] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [governmentId, setGovernmentId] = useState<File | null>(null);
  const [registration, setRegistration] = useState<File | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scan first, type last: the two documents are captured in order, and the
  // form opens on what the registration scan read, for final edits.
  const [stage, setStage] = useState<DocStep | 'details'>('government_id');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<boolean | null>(null);

  async function scanThenEdit() {
    setScanning(true);
    const suggestions = registration ? await scanForSuggestions(registration) : null;
    if (suggestions) {
      if (suggestions.companyName) setCompanyName(suggestions.companyName);
      if (suggestions.tin) setTin(suggestions.tin);
    }
    setScanned(Boolean(suggestions?.companyName || suggestions?.tin));
    setScanning(false);
    setStage('details');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let created: CompanyResponse | null = null;
    try {
      created = await apiPost<CompanyResponse>('/me/companies', {
        companyName,
        tin,
        billingAddress,
        contactMobile,
      });
      const bounced = await uploadDocuments(created.id, { governmentId, registration });
      await queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
      if (bounced.length > 0) {
        toast.error(
          'A document was too unclear to read',
          `${bounced.join(' and ')} could not be read. Upload a clearer copy from the company page.`,
        );
      } else {
        toast.success(
          'Company added',
          'The rental team will verify it. You can request quotes now.',
        );
      }
      await navigate({ to: '/account/companies' });
    } catch (err) {
      // The company exists even if an upload failed; say so, and send the
      // customer to finish the upload rather than create a duplicate.
      if (created) {
        await queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
        toast.error('Company saved, but a document did not upload', apiErrorText(err));
        await navigate({ to: '/account/companies' });
        return;
      }
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (stage !== 'details') {
    const step = DOC_STEPS.find((s) => s.type === stage)!;
    const file = stage === 'government_id' ? governmentId : registration;
    const setFile = stage === 'government_id' ? setGovernmentId : setRegistration;
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="My account"
          title="Add a company"
          description="Scan the documents first; you will check the details at the end."
        />
        <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
          <DocumentStep step={step} value={file} onChange={setFile} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!file || scanning}
              loading={scanning}
              onClick={() =>
                stage === 'government_id' ? setStage('company_registration') : scanThenEdit()
              }
            >
              {stage === 'government_id' ? 'Next: company registration' : 'Next: check the details'}
            </Button>
            {stage === 'company_registration' ? (
              <Button variant="ghost" onClick={() => setStage('government_id')}>
                Back
              </Button>
            ) : (
              <Link to="/account/companies">
                <Button variant="ghost">Cancel</Button>
              </Link>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Both documents are needed before the rental team can verify this company.
          </p>
        </Surface>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My account"
        title="Add a company"
        description="Check what we read from your documents, and fix anything that is wrong."
      />
      <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {scanned !== null && (
            <p role="status" className="text-sm text-text-muted">
              {scanned
                ? 'Filled in from your registration document. Check every field before you submit.'
                : 'We could not read your registration document, so please fill this in yourself.'}
            </p>
          )}
          <Input
            label="Company name"
            required
            maxLength={200}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <Input
            label="TIN"
            required
            inputMode="numeric"
            placeholder="000-000-000-000"
            pattern="\d{3}-?\d{3}-?\d{3}(-?\d{3})?"
            hint="9 or 12 digits."
            value={tin}
            onChange={(e) => setTin(e.target.value)}
          />
          <Input
            label="Complete billing address"
            required
            maxLength={500}
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
          />
          <Input
            label="Contact mobile"
            type="tel"
            required
            maxLength={30}
            value={contactMobile}
            onChange={(e) => setContactMobile(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-muted">
            <span>
              Scanned: {governmentId ? 'National ID' : 'no ID'} and{' '}
              {registration ? 'company registration' : 'no registration'}.
            </span>
            <Button type="button" variant="ghost" onClick={() => setStage('government_id')}>
              Rescan
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm text-text">
            <input
              type="checkbox"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              I confirm these documents are genuine and consent to the rental team reviewing them
              under the{' '}
              <Link to="/privacy" className="underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={!accepted}>
              Submit
            </Button>
            <Link to="/account/companies">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
          </div>
          <p className="text-xs text-text-muted">
            You can upload the documents later, but payment opens only once the company is verified.
          </p>
        </form>
      </Surface>
    </div>
  );
}

function CompanyDocumentsPage() {
  const { companyId } = accountCompanyDocumentsRoute.useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [governmentId, setGovernmentId] = useState<File | null>(null);
  const [registration, setRegistration] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // Same one-at-a-time order as adding a company. No scan here: the company
  // already exists, so there is nothing left to prefill.
  const [stage, setStage] = useState<DocStep>('government_id');
  // "Next" (step 1) and "Upload" (step 2) sit in the same spot in this
  // button row. A fast double-tap -- or any input lag between the two
  // taps registering -- lands the second tap on "Upload" the instant it
  // replaces "Next", submitting with only the government ID and bouncing
  // the customer out before they ever see the registration step. Guard
  // submit() against firing within advanceGraceMs of the stage flip that
  // put "Upload" under the customer's finger.
  const stageChangedAt = useRef(0);
  const advanceGraceMs = 400;

  const step = DOC_STEPS.find((s) => s.type === stage)!;
  const file = stage === 'government_id' ? governmentId : registration;
  const setFile = stage === 'government_id' ? setGovernmentId : setRegistration;

  function advanceToRegistration() {
    stageChangedAt.current = Date.now();
    setStage('company_registration');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Both steps share one <form> (the step-1 "Next" button lives here too,
    // as type="button"). A stray submit event firing while still on step 1
    // must never upload a partial set and navigate away before the customer
    // ever sees the registration step -- that reads as the flow being
    // "stuck" and leaves an orphaned government_id document behind.
    if (stage !== 'company_registration') return;
    if (Date.now() - stageChangedAt.current < advanceGraceMs) return;
    setBusy(true);
    try {
      const bounced = await uploadDocuments(companyId, { governmentId, registration });
      await queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
      if (bounced.length > 0) {
        toast.error(
          'A document was too unclear to read',
          `${bounced.join(' and ')} could not be read. Upload a clearer copy from the company page.`,
        );
      } else {
        toast.success('Documents uploaded');
      }
      await navigate({ to: '/account/companies' });
    } catch (err) {
      toast.error('Upload failed', apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Companies" title="Upload documents" />
      <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DocumentStep step={step} value={file} onChange={setFile} />
          <div className="flex flex-wrap gap-2">
            {stage === 'government_id' ? (
              <Button
                type="button"
                variant="primary"
                disabled={!governmentId}
                onClick={advanceToRegistration}
              >
                Next: company registration
              </Button>
            ) : (
              <>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!governmentId && !registration}
                >
                  Upload
                </Button>
                <Button type="button" variant="ghost" onClick={() => setStage('government_id')}>
                  Back
                </Button>
              </>
            )}
          </div>
        </form>
      </Surface>
    </div>
  );
}

export const accountCompaniesRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies',
  component: CompaniesPage,
});

export const accountCompanyNewRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies/new',
  component: NewCompanyPage,
});

export const accountCompanyDocumentsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies/$companyId/documents',
  component: CompanyDocumentsPage,
});
