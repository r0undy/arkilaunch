import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TenantApplication, TenantApplicationListResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button } from '../components/button.js';

const applicationsListQuery = {
  queryKey: ['tenants', 'applications'] as const,
  queryFn: () => apiGet<TenantApplicationListResponse>('/tenants/applications'),
};

function ApplicationActions({ application }: { application: TenantApplication }) {
  const queryClient = useQueryClient();
  const [activationToken, setActivationToken] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tenants', 'applications'] });

  const approve = useMutation({
    mutationFn: () =>
      apiPost<{ activationToken?: string }>(`/tenants/${application.tenantId}/approve`, {}),
    onSuccess: (data) => {
      if (data.activationToken) setActivationToken(data.activationToken);
      invalidate();
    },
  });
  const reject = useMutation({
    mutationFn: () => apiPost(`/tenants/${application.tenantId}/reject`, {}),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="approve" size="field" onClick={() => approve.mutate()} loading={approve.isPending}>
        Approve
      </Button>
      <Button variant="destructive" size="field" onClick={() => reject.mutate()} loading={reject.isPending}>
        Reject
      </Button>
      {activationToken && (
        <span className="text-sm text-text-muted">
          No email provider is wired up yet -- relay this activation token to the owner out of band:{' '}
          <code className="rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">{activationToken}</code>
        </span>
      )}
    </div>
  );
}

function PlatformApplicationsPage() {
  const columns: TableColumn<TenantApplication>[] = [
    { header: 'Company', cell: (row) => row.companyName },
    { header: 'Contact', cell: (row) => `${row.contactFirstName} ${row.contactLastName}` },
    { header: 'Submitted', cell: (row) => row.createdAt.toLocaleDateString() },
    { header: 'Actions', cell: (row) => <ApplicationActions application={row} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Tenant applications</h1>
      <DataPanel
        title="Pending applications"
        options={applicationsListQuery}
        emptyTitle="No pending applications"
        emptyDescription="New tenant registrations will appear here for review."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={columns} rows={data.items} rowKey={(row) => row.applicationId} />}
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
