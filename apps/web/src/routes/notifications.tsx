import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { adminLayoutRoute } from './_admin.js';
import { accountLayoutRoute } from './_account.js';
import { fieldLayoutRoute } from './_field.js';
import { PageHeader } from '../components/page-header.js';
import { NotificationFeed } from '../components/notification-feed.js';

// Figma 276:7669 (admin), 168:3011 (customer), 359:2970 (operator). The
// three frames differ only in the shell around them, which the layout
// routes already supply, so they share one feed rather than three copies.
function NotificationsPage({ eyebrow, description }: { eyebrow: string; description: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={eyebrow} title="Notification centre" description={description} />
      <NotificationFeed />
    </div>
  );
}

export const appNotificationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/notifications',
  component: () => (
    <NotificationsPage
      eyebrow="Dispatch"
      description="Maintenance alerts, weather advisories and review-queue items."
    />
  ),
});

export const adminNotificationsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/admin/notifications',
  component: () => (
    <NotificationsPage
      eyebrow="Dispatch"
      description="Maintenance alerts, weather advisories and review-queue items."
    />
  ),
});

export const accountNotificationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/notifications',
  component: () => (
    <NotificationsPage eyebrow="My account" description="Updates on your bookings and invoices." />
  ),
});

export const fieldNotificationsRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/notifications',
  component: () => (
    <NotificationsPage eyebrow="Field" description="What needs doing on your assigned sites." />
  ),
});
