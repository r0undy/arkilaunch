import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { adminLayoutRoute } from './_admin.js';
import { fieldLayoutRoute } from './_field.js';
import { usersQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon } from '../components/icons.js';
import { formatDate, formatStatus, shortCode } from '../lib/format.js';

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border pt-3">
      <span className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
        {label}
      </span>
      <span className="text-text">{value}</span>
    </div>
  );
}

// Figma 271:6855 (Admin Profile) and 360:4903 (Operator Profile). Both
// frames show an editable profile card; GET /users/me is read-only and
// there is no endpoint that writes a display name, avatar or phone number
// back, so this shows the identity the JWT and the API actually agree on
// and offers no edit affordance it cannot honour.
function ProfilePage({ eyebrow }: { eyebrow: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={eyebrow}
        title="My profile"
        description="The account you are signed in with."
      />
      <DataPanel
        title="Profile"
        options={usersQueries.me()}
        emptyTitle="Profile unavailable"
        emptyDescription="Your account could not be read. Try signing out and back in."
        isEmpty={(data) => !data?.id}
        render={(user) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,380px)_1fr]">
            <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary font-display text-lg font-semibold text-text"
                >
                  {user.email.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-semibold text-text">
                    {user.email}
                  </p>
                  <p className="text-sm text-text-muted">{formatStatus(user.role)}</p>
                </div>
              </div>
              <ProfileRow label="Role" value={formatStatus(user.role)} />
              <ProfileRow label="Member since" value={formatDate(user.createdAt)} />
              <ProfileRow label="Reference" value={shortCode('customer', user.id)} />
            </Surface>

            <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
                Workspace
              </h2>
              <div className="flex items-center gap-2">
                <StatusPill
                  tone={user.status === 'active' ? 'recon-approved' : 'recon-review'}
                  label={formatStatus(user.status)}
                  icon={<CheckIcon />}
                />
              </div>
              <ProfileRow label="Tenant" value={user.tenantName} />
              <ProfileRow label="Workspace slug" value={user.tenantSlug} />
              <p className="border-t border-border pt-3 text-sm text-text-muted">
                Your role and workspace are set by an administrator. To change your password or
                your access, ask the admin who invited you -- there is no self-service edit here
                yet.
              </p>
            </Surface>
          </div>
        )}
      />
    </div>
  );
}

export const appProfileRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/profile',
  component: () => <ProfilePage eyebrow="Account" />,
});

export const adminProfileRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/admin/profile',
  component: () => <ProfilePage eyebrow="Account" />,
});

export const fieldProfileRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/profile',
  component: () => <ProfilePage eyebrow="Field" />,
});
