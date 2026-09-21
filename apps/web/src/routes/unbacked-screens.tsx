import { createRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { appLayoutRoute } from './_app.js';
import { fieldLayoutRoute } from './_field.js';
import { PageHeader } from '../components/page-header.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';

// The Figma prototype's remaining screens, mounted so the information
// architecture is complete and reviewable. Every one of them is here
// WITHOUT a backend: no ticket table, no audit endpoint, no negotiation
// model, no per-role settings write.
//
// They deliberately do not render sample rows. A queue full of invented
// tickets or fabricated security events is worse than an empty one -- it
// looks finished, it gets screenshotted into a report, and nobody can tell
// which numbers were real. Each screen instead names the exact thing that
// is missing, which is what the next Change Record has to build.
// Recorded in docs/report-figma-route-alignment.md §5.
function GapScreen({
  eyebrow,
  title,
  description,
  gapTitle,
  gap,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  gapTitle: string;
  gap: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState title={gapTitle} description={gap} {...(action ? { action } : {})} />
    </div>
  );
}

export const appTicketsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/tickets',
  component: () => (
    <GapScreen
      eyebrow="Support"
      title="Ticket management"
      description="Support requests raised by customers and crew."
      gapTitle="There is no ticket store yet"
      gap="Nothing in the schema holds a support ticket and no endpoint creates, lists or closes one. Until that exists this screen can only show invented tickets, so it shows none. Customers reaching for help today go through the contact page, which is a real destination."
      action={
        <Link to="/contact">
          <Button variant="primary">Open the contact page</Button>
        </Link>
      }
    />
  ),
});

export const appSecurityLogsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/security-logs',
  component: () => (
    <GapScreen
      eyebrow="Administration"
      title="Security logs"
      description="Who signed in, what changed, and when."
      gapTitle="Audit events are recorded but not readable"
      gap="Approvals and deductions write an audit trail -- an invoice can show its own -- but there is no endpoint that reads audit events across the tenant, so there is nothing to list here. Wiring this needs an audit query and its own Change Record; inventing rows on a security screen would be the worst possible place to do it."
      action={
        <Link to="/app/incidents">
          <Button variant="primary">Open the incident log</Button>
        </Link>
      }
    />
  ),
});

export const fieldSettingsRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/settings',
  component: () => (
    <GapScreen
      eyebrow="Field"
      title="Settings"
      description="How this console behaves for you."
      gapTitle="Nothing is adjustable from here yet"
      gap="The operator console has no per-user preferences to store and no endpoint to store them in. Your role, your sites and your access are set by an administrator."
      action={
        <Link to="/field/profile">
          <Button variant="primary">See my profile</Button>
        </Link>
      }
    />
  ),
});

