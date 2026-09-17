import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TenantApplication } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { DataPanel } from '../components/data-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { ApplicationActions, applicationsListQuery } from '../components/application-actions.js';
import { formatDate, shortCode } from '../lib/format.js';

// Figma splits company approval across four frames: Pending Company Approval
// (621:8341), Approved Companies (621:8533), Manage Company Application
// (369:1589) and Registration Review (349:942). The API backs exactly one of
// them: GET /tenants/applications, which is a SECURITY DEFINER function
// returning PENDING rows only. There is no approved-companies query, no
// per-application query, and no KYC list. Rather than fabricate rows to fill
// the other frames, the screens that have no endpoint say so plainly --
// the same choice cr-arkilaunch-frontend-storefront-shell.md made for the
// screens it could not wire.

function CompanyLink({ application }: { application: TenantApplication }) {
  return (
    <Link
      to="/app/companies/$applicationId"
      params={{ applicationId: application.applicationId }}
      className="font-semibold text-accent underline"
    >
      {application.companyName}
    </Link>
  );
}

const COLUMNS: TableColumn<TenantApplication>[] = [
  { header: 'Company', cell: (row) => <CompanyLink application={row} /> },
  {
    header: 'Representative',
    cell: (row) => (
      <span className="flex flex-col">
        <span>{`${row.contactFirstName} ${row.contactLastName}`}</span>
        <span className="text-xs text-text-muted">{row.contactJobTitle}</span>
      </span>
    ),
  },
  { header: 'Submitted', cell: (row) => formatDate(row.createdAt) },
  { header: 'Actions', cell: (row) => <ApplicationActions application={row} /> },
];

function CompaniesPendingPage() {
  const [offset, setOffset] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Registration"
        title="Pending company approval"
        description="Businesses waiting on a decision before they get a workspace."
      />
      <DataPanel
        title="Pending companies"
        options={applicationsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No companies waiting"
        emptyDescription="New company registrations appear here for review."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.applicationId} />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="companies"
            />
          </div>
        )}
      />
    </div>
  );
}

function CompaniesApprovedPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Registration"
        title="Approved companies"
        description="Businesses already granted a workspace."
      />
      <EmptyState
        title="Approved companies are not listed yet"
        description="The platform can approve a company, but nothing reads the approved list back: tenants_list_pending_applications returns pending rows only and no endpoint replaces it. Until that query exists this screen would have to invent its rows, so it shows none."
        action={
          <Link to="/app/companies/pending">
            <Button variant="primary">Review pending companies</Button>
          </Link>
        }
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border pt-3">
      <span className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
        {label}
      </span>
      <span className="text-text">{value}</span>
    </div>
  );
}

function CompanyApplicationPage() {
  const { applicationId } = appCompanyApplicationRoute.useParams();
  const applications = useQuery(applicationsListQuery(PAGE_SIZE, 0));
  const application = applications.data?.items.find((row) => row.applicationId === applicationId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Registration"
        title={application?.companyName ?? 'Company application'}
        description="Who applied, and what they told us."
        actions={
          <Link to="/app/companies/pending">
            <Button variant="ghost">Back</Button>
          </Link>
        }
      />

      {applications.isPending && <p className="text-sm text-text-muted">Loading application...</p>}

      {applications.isSuccess && !application && (
        <EmptyState
          title="Application not found"
          description="It is not in the pending queue. It may already have been approved or rejected, and there is no endpoint that reads a decided application back."
        />
      )}

      {application && (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,340px)]">
          <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
            <h2 className="font-display text-lg font-semibold text-text">Entity details</h2>
            <DetailRow label="Company" value={application.companyName} />
            <DetailRow
              label="Representative"
              value={`${application.contactFirstName} ${application.contactLastName}`}
            />
            <DetailRow label="Job title" value={application.contactJobTitle} />
            <DetailRow label="Contact number" value={application.contactMobile} />
            <DetailRow label="Date applied" value={formatDate(application.createdAt)} />
            <DetailRow label="Reference" value={shortCode('customer', application.applicationId)} />
          </Surface>

          <div className="flex min-w-0 flex-col gap-4">
            <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
                Decision
              </h2>
              <ApplicationActions application={application} />
            </Surface>

            {/* The frame also carries a compliance repository (business
                permit, SEC certificate, tax ID, each with a verified date)
                and a verification trail. GET /kyc/:id reads one document by
                its own id and nothing lists a tenant's documents, so neither
                panel can be populated. Recorded in the alignment report
                rather than mocked up with sample filenames. */}
            <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
                Compliance documents
              </h2>
              <p className="text-sm text-text-muted">
                The submitted permits are not readable from here. KYC documents are fetched one at a
                time by document id and nothing lists them per tenant, so this panel stays empty
                until that endpoint exists.
              </p>
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}

export const appCompaniesPendingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/companies/pending',
  beforeLoad: requireRole('platform_admin'),
  component: CompaniesPendingPage,
});

export const appCompaniesApprovedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/companies/approved',
  beforeLoad: requireRole('platform_admin'),
  component: CompaniesApprovedPage,
});

export const appCompanyApplicationRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/companies/$applicationId',
  beforeLoad: requireRole('platform_admin'),
  component: CompanyApplicationPage,
});
