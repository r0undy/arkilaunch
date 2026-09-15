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
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { formatDate } from '../lib/format.js';

const applicationsListQuery = (limit: number, offset: number) => ({
  queryKey: ['tenants', 'applications', limit, offset] as const,
  queryFn: () =>
    apiGet<TenantApplicationListResponse>(`/tenants/applications?limit=${limit}&offset=${offset}`),
});

function ApplicationActions({ application }: { application: TenantApplication }) {
  const queryClient = useQueryClient();
  const [activationToken, setActivationToken] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tenants', 'applications'] });

  const toast = useToast();
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);

  const approve = useMutation({
    mutationFn: () =>
      apiPost<{ activationToken?: string }>(`/tenants/${application.tenantId}/approve`, {}),
    onSuccess: (data) => {
      if (data.activationToken) setActivationToken(data.activationToken);
      invalidate();
      toast.success('Application approved', `${application.companyName} can now be set up.`);
    },
    onError: () => toast.error('Could not approve that application', 'Nothing was changed.'),
  });
  const reject = useMutation({
    mutationFn: () => apiPost(`/tenants/${application.tenantId}/reject`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Application rejected', `${application.companyName} was not approved.`);
    },
    onError: () => toast.error('Could not reject that application', 'Nothing was changed.'),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="approve"
        size="field"
        onClick={() => setConfirming('approve')}
        loading={approve.isPending}
      >
        Approve
      </Button>
      <Button
        variant="destructive"
        size="field"
        onClick={() => setConfirming('reject')}
        loading={reject.isPending}
      >
        Reject
      </Button>
      {activationToken && (
        <span className="text-sm text-text-muted">
          Send this sign-up link to the owner:{' '}
          <code className="rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">
            {activationToken}
          </code>
        </span>
      )}

      <ConfirmDialog
        open={confirming === 'approve'}
        title="Approve this company?"
        tone="approve"
        confirmLabel="Approve"
        pending={approve.isPending}
        body={
          <p>
            <strong>{application.companyName}</strong> gets its own workspace, and you will get a
            sign-up link to send to the owner.
          </p>
        }
        onConfirm={() => {
          approve.mutate();
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === 'reject'}
        title="Reject this application?"
        tone="danger"
        confirmLabel="Reject"
        pending={reject.isPending}
        body={
          <p>
            <strong>{application.companyName}</strong> will not get a workspace. They would have to
            apply again.
          </p>
        }
        onConfirm={() => {
          reject.mutate();
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

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
