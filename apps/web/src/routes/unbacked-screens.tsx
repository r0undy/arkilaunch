import { createRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { appLayoutRoute } from './_app.js';
import { adminLayoutRoute } from './_admin.js';
import { fieldLayoutRoute } from './_field.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { buttonClass } from '../components/button.js';

// Deliberately no sample rows: invented data looks finished and gets reported as real.
function GapScreen({
  title,
  description,
  gapTitle,
  gap,
  action,
}: {
  title: string;
  description: string;
  gapTitle: string;
  gap: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} description={description} />
      <EmptyState title={gapTitle} description={gap} {...(action ? { action } : {})} />
    </div>
  );
}

export const appTicketsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/tickets',
  component: () => (
    <GapScreen
      title="Ticket management"
      description="Support requests raised by customers and crew."
      gapTitle="There is no ticket store yet"
      gap="Nothing in the schema holds a support ticket and no endpoint creates, lists or closes one. Until that exists this screen can only show invented tickets, so it shows none. Customers reaching for help today go through the contact page, which is a real destination."
      action={
        <Link to="/contact" className={buttonClass('primary')}>Open the contact page</Link>
      }
    />
  ),
});

export const appSecurityLogsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/security-logs',
  component: () => (
    <GapScreen
      title="Security logs"
      description="Who signed in, what changed, and when."
      gapTitle="Audit events are recorded but not readable"
      gap="Approvals and deductions write an audit trail -- an invoice can show its own -- but there is no endpoint that reads audit events across the tenant, so there is nothing to list here. Wiring this needs an audit query and its own Change Record; inventing rows on a security screen would be the worst possible place to do it."
      action={
        <Link to="/app/incidents" className={buttonClass('primary')}>Open the incident log</Link>
      }
    />
  ),
});

export const adminSecurityLogsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/admin/security-logs',
  component: () => (
    <GapScreen
      title="Security logs"
      description="Who signed in, what changed, and when."
      gapTitle="Audit events are recorded but not readable"
      gap="Approvals and deductions write an audit trail -- an invoice can show its own -- but there is no endpoint that reads audit events across the tenant, so there is nothing to list here. Wiring this needs an audit query and its own Change Record; inventing rows on a security screen would be the worst possible place to do it."
      action={
        <Link to="/admin/applications" className={buttonClass('primary')}>Open applications</Link>
      }
    />
  ),
});

export const fieldSettingsRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/settings',
  component: () => (
    <GapScreen
      title="Settings"
      description="How this console behaves for you."
      gapTitle="Nothing is adjustable from here yet"
      gap="The operator console has no per-user preferences to store and no endpoint to store them in. Your role, your sites and your access are set by an administrator."
      action={
        <Link to="/field/profile" className={buttonClass('primary')}>See my profile</Link>
      }
    />
  ),
});
