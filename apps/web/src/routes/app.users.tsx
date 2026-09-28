import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssignableRole } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { adminLayoutRoute } from './_admin.js';
import { requireRole } from '../lib/guards.js';
import { apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { formatRole } from '../lib/format.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Modal } from '../components/modal.js';
import { StatusBadge } from '../components/status-badge.js';
import { Users } from 'lucide-react';

interface UserRow {
  id: string;
  email: string;
  status: 'active' | 'invited' | 'disabled' | 'locked';
  roleName: string;
  createdAt: string;
}

interface UserListResponse {
  items: UserRow[];
  total: number;
}

const usersListQuery = (limit: number, offset: number) => ({
  queryKey: ['users', limit, offset] as const,
  queryFn: () => apiGet<UserListResponse>(`/users?limit=${limit}&offset=${offset}`),
});

// Invite in a dialog. Once sent, the dialog stays open on the activation
// token (there is no email provider yet), and closing it clears the form.
function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('customer');
  const [activationToken, setActivationToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => apiPost<{ id: string; activationToken: string }>('/users', { email, role }),
    onSuccess: (data) => {
      setActivationToken(data.activationToken);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () =>
      setError('Could not invite this user. Check the email is not already registered.'),
  });

  function close() {
    setActivationToken(null);
    setError(null);
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setActivationToken(null);
    invite.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite a user"
      description="They get an account on your company with the role you pick."
      size="sm"
      footer={
        activationToken ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="invite-user" loading={invite.isPending}>
              Send invite
            </Button>
          </>
        )
      }
    >
      {activationToken ? (
        <p className="text-sm text-text">
          Invite created. No email provider is wired up yet -- relay this activation token to the new user out of
          band:{' '}
          <code className="break-all rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">{activationToken}</code>
        </p>
      ) : (
        <form id="invite-user" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label="Email address"
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...(error ? { error } : {})}
          />
          <Select label="Role" id="invite-role" value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
            <option value="customer">Customer</option>
            <option value="timekeeper">Timekeeper</option>
            <option value="admin">Admin</option>
          </Select>
        </form>
      )}
    </Modal>
  );
}

const ASSIGNABLE_ROLES: AssignableRole[] = ['customer', 'timekeeper', 'admin'];

function UserActions({ user }: { user: UserRow }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<AssignableRole | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingReactivate, setConfirmingReactivate] = useState(false);
  const toast = useToast();

  const changeRole = useMutation({
    mutationFn: (role: AssignableRole) => apiPatch(`/users/${user.id}/role`, { role }),
    onSuccess: (_data, role) => {
      invalidate();
      toast.success('Role changed', `${user.email} is now ${formatRole(role).toLowerCase()}.`);
    },
    onError: () =>
      toast.error('Could not change that role', 'Nothing was changed. Try again in a moment.'),
  });
  const reinvite = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; activationToken: string }>(`/users/${user.id}/invite`, {}),
    onSuccess: (data) => {
      setLastToken(data.activationToken);
      toast.success('New invite ready', 'Send the sign-up link below to this person.');
    },
    onError: () => toast.error('Could not create an invite', 'Nothing was sent.'),
  });
  const resetPassword = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; activationToken: string }>(`/users/${user.id}/reset-password`, {}),
    onSuccess: (data) => {
      setLastToken(data.activationToken);
      toast.success('Password reset started', 'Their current password no longer works.');
    },
    onError: () => toast.error('Could not reset that password', 'Nothing was changed.'),
  });
  const deactivate = useMutation({
    mutationFn: () => apiPost(`/users/${user.id}/deactivate`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Access removed', `${user.email} can no longer sign in.`);
    },
    onError: () => toast.error('Could not remove access', 'Nothing was changed.'),
  });
  const reactivate = useMutation({
    mutationFn: () => apiPost(`/users/${user.id}/reactivate`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Access restored', `${user.email} can sign in again.`);
    },
    onError: () => toast.error('Could not restore access', 'Nothing was changed.'),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ASSIGNABLE_ROLES.includes(user.roleName as AssignableRole) && (
        <Select
          labelHidden
          label={`Change role for ${user.email}`}
          value={user.roleName}
          disabled={changeRole.isPending}
          onChange={(e) => setPendingRole(e.target.value as AssignableRole)}
          className="min-w-36 text-sm"
        >
          {ASSIGNABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {formatRole(role)}
            </option>
          ))}
        </Select>
      )}
      {user.status === 'invited' && (
        <Button
          variant="secondary"
          size="field"
          onClick={() => reinvite.mutate()}
          loading={reinvite.isPending}
        >
          Re-invite
        </Button>
      )}
      <Button
        variant="secondary"
        size="field"
        onClick={() => setConfirmingReset(true)}
        loading={resetPassword.isPending}
      >
        Reset password
      </Button>
      {user.status === 'disabled' ? (
        <Button
          variant="secondary"
          size="field"
          onClick={() => setConfirmingReactivate(true)}
          loading={reactivate.isPending}
        >
          Reactivate
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="field"
          onClick={() => setConfirmingDeactivate(true)}
          loading={deactivate.isPending}
        >
          Remove access
        </Button>
      )}
      {lastToken && (
        <code className="rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">
          {lastToken}
        </code>
      )}

      <ConfirmDialog
        open={pendingRole !== null}
        title="Change this role?"
        tone={pendingRole === 'admin' ? 'danger' : 'neutral'}
        confirmLabel="Change role"
        pending={changeRole.isPending}
        body={
          <>
            <p>
              <strong>{user.email}</strong> becomes {formatRole(pendingRole ?? '').toLowerCase()}.
            </p>
            {pendingRole === 'admin' && (
              <p className="mt-2">
                Administrators can approve field logs, which takes money from a deposit.
              </p>
            )}
          </>
        }
        onConfirm={() => {
          if (pendingRole) changeRole.mutate(pendingRole);
          setPendingRole(null);
        }}
        onCancel={() => setPendingRole(null)}
      />

      <ConfirmDialog
        open={confirmingDeactivate}
        title="Remove this person's access?"
        tone="danger"
        confirmLabel="Remove access"
        pending={deactivate.isPending}
        body={
          <p>
            <strong>{user.email}</strong> will be signed out and cannot sign in again until someone
            restores their access. Everything they recorded stays intact.
          </p>
        }
        onConfirm={() => {
          deactivate.mutate();
          setConfirmingDeactivate(false);
        }}
        onCancel={() => setConfirmingDeactivate(false)}
      />

      <ConfirmDialog
        open={confirmingReactivate}
        title="Restore this person's access?"
        tone="approve"
        confirmLabel="Restore access"
        pending={reactivate.isPending}
        body={
          <p>
            <strong>{user.email}</strong> can sign in again as {formatRole(user.roleName).toLowerCase()}.
          </p>
        }
        onConfirm={() => {
          reactivate.mutate();
          setConfirmingReactivate(false);
        }}
        onCancel={() => setConfirmingReactivate(false)}
      />

      <ConfirmDialog
        open={confirmingReset}
        title="Reset this password?"
        tone="danger"
        confirmLabel="Reset password"
        pending={resetPassword.isPending}
        body={
          <p>
            <strong>{user.email}</strong> will be signed out and their current password will stop
            working. You will get a link to send them.
          </p>
        }
        onConfirm={() => {
          resetPassword.mutate();
          setConfirmingReset(false);
        }}
        onCancel={() => setConfirmingReset(false)}
      />
    </div>
  );
}

function ManageUsersPage() {
  const [offset, setOffset] = useState(0);
  const [inviting, setInviting] = useState(false);
  const columns: TableColumn<UserRow>[] = [
    {
      header: 'Email',
      kind: 'text',
      cell: (row) => (
        <a href={`mailto:${row.email}`} className="text-accent hover:underline">
          {row.email}
        </a>
      ),
    },
    { header: 'Role', kind: 'text', cell: (row) => formatRole(row.roleName) },
    { header: 'Status', kind: 'status', cell: (row) => <StatusBadge status={row.status} /> },
    { header: 'Actions', kind: 'action', cell: (row) => <UserActions user={row} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="People"
        description="Manage teammates, roles, and access."
        actions={<Button onClick={() => setInviting(true)}>Invite a user</Button>}
      />
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
      <DataPanel
        title="Users"
        options={usersListQuery(PAGE_SIZE, offset)}
        emptyTitle="No users yet"
        emptyDescription="Invite your first teammate."
        emptyIcon={Users}
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <Table
            columns={columns}
            rows={data.items}
            rowKey={(row) => row.id}
            header={{ title: 'People', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="people" /> }}
          />
        )}
      />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD §5.2 auth boundary.
export const appUsersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/users',
  beforeLoad: requireRole('admin'),
  component: ManageUsersPage,
});

// The platform's own staff (the arkilaunch-platform tenant's users).
export const adminUsersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/admin/users',
  component: ManageUsersPage,
});
