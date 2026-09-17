import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { TenantApplication } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { formatDate } from '../lib/format.js';
import {
  ApplicationActions,
  applicationsListQuery,
} from '../components/application-actions.js';

function PlatformApplicationsPage() {
  const [offset, setOffset] = useState(0);
  const columns: TableColumn<TenantApplication>[] = [
    { header: 'Company', cell: (row) => row.companyName },
    { header: 'Contact', cell: (row) => `${row.contactFirstName} ${row.contactLastName}` },
    { header: 'Submitted', cell: (row) => formatDate(row.createdAt) },
    { header: 'Actions', cell: (row) => <ApplicationActions application={row} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Platform"
        title="Company applications"
        description="Businesses asking to join, waiting on your decision."
      />
      <DataPanel
        title="Pending applications"
        options={applicationsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No pending applications"
        emptyDescription="New tenant registrations will appear here for review."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={columns} rows={data.items} rowKey={(row) => row.applicationId} />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="applications"
            />
          </div>
        )}
      />
    </div>
  );
}

// platform_admin only -- tenant:approve is a cross-tenant permission
// (tenants_list_pending_applications is a SECURITY DEFINER function), never
// granted to a tenant's own admin/owner.
export const appPlatformApplicationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/platform-applications',
  beforeLoad: requireRole('platform_admin'),
  component: PlatformApplicationsPage,
});
