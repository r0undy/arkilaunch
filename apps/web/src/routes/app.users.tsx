import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssignableRole } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';

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

const usersListQuery = {
  queryKey: ['users'] as const,
  queryFn: () => apiGet<UserListResponse>('/users'),
};

function InviteForm() {
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
    onError: () => setError('Could not invite this user. Check the email is not already registered.'),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setActivationToken(null);
    invite.mutate();
  }

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
      <h2 className="font-display text-base font-semibold text-text">Invite a user</h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            label="Email address"
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...(error ? { error } : {})}
          />
        </div>
        <div className="w-40">
          <Select label="Role" id="invite-role" value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
            <option value="customer">Customer</option>
            <option value="timekeeper">Timekeeper</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        <Button type="submit" loading={invite.isPending} disabled={invite.isPending}>
          Send invite
        </Button>
      </form>
      {activationToken && (
        <p className="text-sm text-text-muted">
          No email provider is wired up yet -- relay this activation token to the new user out of band:{' '}
          <code className="rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">{activationToken}</code>
        </p>
      )}
    </Surface>
  );
}

const ASSIGNABLE_ROLES: AssignableRole[] = ['customer', 'timekeeper', 'admin'];

function UserActions({ user }: { user: UserRow }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const [lastToken, setLastToken] = useState<string | null>(null);

  const changeRole = useMutation({
    mutationFn: (role: AssignableRole) => apiPatch(`/users/${user.id}/role`, { role }),
    onSuccess: invalidate,
  });
  const reinvite = useMutation({
    mutationFn: () => apiPost<{ id: string; activationToken: string }>(`/users/${user.id}/invite`, {}),
    onSuccess: (data) => setLastToken(data.activationToken),
  });
  const resetPassword = useMutation({
    mutationFn: () => apiPost<{ id: string; activationToken: string }>(`/users/${user.id}/reset-password`, {}),
    onSuccess: (data) => setLastToken(data.activationToken),
  });
  const deactivate = useMutation({
    mutationFn: () => apiPost(`/users/${user.id}/deactivate`, {}),
    onSuccess: invalidate,
  });
  const reactivate = useMutation({
    mutationFn: () => apiPost(`/users/${user.id}/reactivate`, {}),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ASSIGNABLE_ROLES.includes(user.roleName as AssignableRole) && (
        <select
          aria-label={`Change role for ${user.email}`}
          value={user.roleName}
          disabled={changeRole.isPending}
          onChange={(e) => changeRole.mutate(e.target.value as AssignableRole)}
          className="min-h-11 rounded-sm border border-border bg-surface px-2 text-sm text-text"
        >
          {ASSIGNABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      )}
      {user.status === 'invited' && (
        <Button variant="secondary" size="field" onClick={() => reinvite.mutate()} loading={reinvite.isPending}>
          Re-invite
        </Button>
      )}
      <Button variant="secondary" size="field" onClick={() => resetPassword.mutate()} loading={resetPassword.isPending}>
        Reset password
      </Button>
      {user.status === 'disabled' ? (
        <Button variant="secondary" size="field" onClick={() => reactivate.mutate()} loading={reactivate.isPending}>
          Reactivate
        </Button>
      ) : (
        <Button variant="destructive" size="field" onClick={() => deactivate.mutate()} loading={deactivate.isPending}>
          Deactivate
        </Button>
      )}
      {lastToken && (
        <code className="rounded-sm bg-surface-sunk px-1.5 py-0.5 font-mono text-xs">{lastToken}</code>
      )}
    </div>
  );
}

function ManageUsersPage() {
  const columns: TableColumn<UserRow>[] = [
    { header: 'Email', cell: (row) => row.email },
    { header: 'Role', cell: (row) => row.roleName },
    { header: 'Status', cell: (row) => row.status },
    { header: 'Actions', cell: (row) => <UserActions user={row} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Manage users</h1>
      <InviteForm />
      <DataPanel
        title="Users"
        options={usersListQuery}
        emptyTitle="No users yet"
        emptyDescription="Invite your first teammate above."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={columns} rows={data.items} rowKey={(row) => row.id} />}
      />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD §5.2 auth boundary.
export const appUsersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/users',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: ManageUsersPage,
});
