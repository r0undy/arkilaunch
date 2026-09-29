import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { adminLayoutRoute } from './_admin.js';
import { accountLayoutRoute } from './_account.js';
import { fieldLayoutRoute } from './_field.js';
import { PageHeader } from '../components/page-header.js';
import { NotificationFeed } from '../components/notification-feed.js';
import { PushAlertsToggle } from '../components/push-alerts-toggle.js';

function NotificationsPage({ description }: { description: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Notifications" description={description} />
      <PushAlertsToggle />
      <NotificationFeed />
    </div>
  );
}

export const appNotificationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/notifications',
  component: () => (
    <NotificationsPage
      description="Maintenance alerts, weather advisories and review-queue items."
    />
  ),
});

export const adminNotificationsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/admin/notifications',
  component: () => (
    <NotificationsPage
      description="Maintenance alerts, weather advisories and review-queue items."
    />
  ),
});

export const accountNotificationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/notifications',
  component: () => (
    <NotificationsPage description="Updates on your bookings and invoices." />
  ),
});

export const fieldNotificationsRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/notifications',
  component: () => (
    <NotificationsPage description="What needs doing on your assigned sites." />
  ),
});
