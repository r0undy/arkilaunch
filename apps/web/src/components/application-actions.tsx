import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TenantApplication,
  TenantApplicationListResponse,
} from '@arkilaunch/shared';
import { apiGet, apiPost } from '../lib/api-client.js';
import { tenantOrigin } from '../lib/host.js';
import { Button } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { useToast } from './toast.js';

// The applications lists and the approve/reject pair are shared by the
// Applications queue, a single application's page and the app bar's count, so they live here instead of being copied.
// Both lists sit under ['tenants', 'applications'], so the one invalidation
// after a decision refreshes the pending and the approved list together.
export const applicationsListQuery = (limit: number, offset: number) => ({
  queryKey: ['tenants', 'applications', limit, offset] as const,
  queryFn: () =>
    apiGet<TenantApplicationListResponse>(`/tenants/applications?limit=${limit}&offset=${offset}`),
});

export function ApplicationActions({ application }: { application: TenantApplication }) {
  const queryClient = useQueryClient();
  const [activation, setActivation] = useState<{ token: string; slug: string | undefined } | null>(null);
  // ['tenants'] covers both the application lists and /admin/companies:
  // an approval adds a company there.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tenants'] });

  const toast = useToast();
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);

  const approve = useMutation({
    mutationFn: () =>
      apiPost<{ activationToken?: string; tenantSlug?: string }>(`/tenants/${application.tenantId}/approve`, {}),
    onSuccess: (data) => {
      if (data.activationToken) setActivation({ token: data.activationToken, slug: data.tenantSlug });
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
      {activation && (
        <span className="text-sm text-text-muted">
          Send this sign-up link to the owner:{' '}
          <code className="rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">
            {/* The owner activates and signs in on their company's own host. */}
            {`${activation.slug ? tenantOrigin(activation.slug) : window.location.origin}/activate?token=${encodeURIComponent(activation.token)}`}
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
