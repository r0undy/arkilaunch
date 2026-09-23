import { createRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompanyResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { companiesQueries } from '../lib/queries.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';
import { VerificationPill } from '../components/company-card.js';

// Figma 251:1945 "Company Applications". The companies one login has
// registered to rent under, their verification state, and where to manage
// each.
//
// This is NOT the tenant onboarding application (GET /tenants/me/application,
// a business becoming an ArkiLaunch tenant), which this screen used to read
// by mistake -- that one is correctly singular, because users.tenantId is a
// single FK and RLS keys off one tenant per JWT. What the design draws is
// the `customers` rows behind GET /me/companies, whose own schema comment
// cites this frame.

type StatusFilter = 'all' | 'pending' | 'approved';

const TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All Applications' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
];

function CounterTile({ value, label }: { value: number; label: string }) {
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-1 p-5">
      <p className="font-display text-3xl font-semibold text-text">{value}</p>
      <p className="text-sm text-text-muted">{label}</p>
    </Surface>
  );
}

// The registration certificate the customer uploaded, as the card's
// thumbnail. It is private KYC evidence, so it is fetched as a short-lived
// signed URL per document rather than served from a public bucket; a company
// with no certificate yet, or a URL that fails, falls back to the label.
function RegistrationThumbnail({ company }: { company: CompanyResponse }) {
  const doc = company.documents.find((d) => d.documentType === 'company_registration');
  const url = useQuery({
    ...companiesQueries.documentUrl(company.id, doc?.id ?? ''),
    enabled: Boolean(doc),
  });

  const frame =
    'h-24 w-32 shrink-0 overflow-hidden rounded-mk-sm border border-border bg-surface-mk';
  if (!doc || url.isError || !url.data) {
    return (
      <div className={`${frame} flex items-center justify-center p-2`}>
        <span className="text-center text-xs text-text-muted">
          {doc ? 'Preview unavailable' : 'No registration document'}
        </span>
      </div>
    );
  }
  return (
    <div className={frame}>
      <img
        src={url.data.url}
        alt={`Registration document for ${company.companyName}`}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

function ApplicationCard({ company }: { company: CompanyResponse }) {
  return (
    <Surface
      radius="md"
      elevation="sm"
      role="group"
      aria-label={company.companyName}
      className="flex flex-wrap items-center gap-5 p-5"
    >
      <RegistrationThumbnail company={company} />
      <div className="flex min-w-48 flex-1 flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-text">{company.companyName}</h2>
        <VerificationPill status={company.kycStatus} />
        <div className="text-sm text-text-muted">
          <p>Registration Number:</p>
          <p className="text-text">{company.secNumber ?? 'Not provided'}</p>
        </div>
      </div>
      <Link to="/account/companies/$companyId" params={{ companyId: company.id }}>
        <Button variant="primary">Manage</Button>
      </Link>
    </Surface>
  );
}

function ApplicationsPage() {
  const companies = useQuery(companiesQueries.mine());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const rows = companies.data ?? [];
  const counts = useMemo(
    () => ({
      total: rows.length,
      approved: rows.filter((c) => c.kycStatus === 'approved').length,
      pending: rows.filter((c) => c.kycStatus === 'pending').length,
    }),
    [rows],
  );

  // ponytail: client-side filter over an unpaginated GET /me/companies --
  // one login holds a handful of companies. Push status + q into SQL if that
  // ever grows past a page.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (status !== 'all' && c.kycStatus !== status) return false;
      if (!q) return true;
      return (
        c.companyName.toLowerCase().includes(q) ||
        (c.secNumber ?? '').toLowerCase().includes(q) ||
        (c.tin ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, status]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My account"
        title="Company Applications"
        description="Manage and track company applications."
        actions={
          <Link to="/account/companies/new">
            <Button variant="primary">Add New Company</Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <CounterTile value={counts.total} label="Total Applications" />
        <CounterTile value={counts.approved} label="Approved" />
        <CounterTile value={counts.pending} label="Pending Approval" />
      </div>

      <div className="flex flex-col gap-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies"
          aria-label="Search companies"
          className="min-h-11 w-full rounded-mk-sm border border-border bg-surface-mk px-4 py-2 text-base text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatus(tab.value)}
              aria-pressed={status === tab.value}
              className={[
                'min-h-11 w-full rounded-pill border px-4 py-2 text-sm font-medium transition-colors sm:w-auto',
                status === tab.value
                  ? 'border-primary bg-primary text-text'
                  : 'border-border bg-surface-mk text-text-muted hover:text-text',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {companies.isPending && <Skeleton label="Loading your companies" rows={2} />}
      {companies.isError && (
        <LoadError
          message="Could not load your companies. Check your connection and try again."
          onRetry={() => companies.refetch()}
        />
      )}
      {companies.isSuccess && rows.length === 0 && (
        <EmptyState
          title="Add your company first"
          description="We need the company you are renting for before a booking: its TIN, billing address, an ID and its registration."
          action={
            <Link to="/account/companies/new">
              <Button variant="primary">Add New Company</Button>
            </Link>
          }
        />
      )}
      {companies.isSuccess && rows.length > 0 && shown.length === 0 && (
        <EmptyState
          title="No companies match"
          description="Try a different search, or switch back to All Applications."
        />
      )}
      {shown.map((company) => (
        <ApplicationCard key={company.id} company={company} />
      ))}
    </div>
  );
}

export const accountApplicationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/applications',
  component: ApplicationsPage,
});
