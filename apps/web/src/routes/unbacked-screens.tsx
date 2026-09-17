import { createRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { appLayoutRoute } from './_app.js';
import { accountLayoutRoute } from './_account.js';
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

export const accountCompanyNewRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies/new',
  component: () => (
    <GapScreen
      eyebrow="My account"
      title="Add a company"
      description="Register another business against your account."
      gapTitle="Company registration starts from the sign-up flow"
      gap="POST /tenants/register is real, but it takes the personal details captured in the first registration step and there is no endpoint that attaches a second company to an account that already exists. Rather than duplicate the form here and submit half of it, this points at the flow that works end to end."
      action={
        <Link to="/register/company">
          <Button variant="primary">Register a company</Button>
        </Link>
      }
    />
  ),
});

// Negotiation: four frames (238:2649 Manage Nego Details, 225:3084 Messenger
// Chat, 225:3085 Call, 225:3087 Nego Finalized). Routes only, per the
// user's decision. cr-arkilaunch-frontend-storefront-shell.md §4 already
// deferred the whole module: no PRD feature, no backend, and no RBAC model
// for a negotiating party. Chat and call additionally need a transport this
// product does not have.
// ponytail: static screens, no transport. A real negotiation needs a
// thread table, an RBAC role for the counterparty, and a Change Record
// before any of this becomes interactive.
// `quoteId` arrives as a prop, taken from each route's OWN useParams().
// It first read accountNegotiationRoute.useParams() for all four screens,
// which threw "Could not find an active match" on the three children: they
// are siblings of that route, not nested under it, so its match is not
// active on /chat, /call or /final and every one of them rendered the error
// boundary instead of a page. Live browser QA caught it; the route-
// resolution test could not, because the route resolves fine -- it is the
// component that blows up once mounted.
function NegotiationScreen({
  title,
  gap,
  quoteId,
}: {
  title: string;
  gap: string;
  quoteId: string;
}) {
  return (
    <GapScreen
      eyebrow="Negotiation"
      title={title}
      description={`Quote ${quoteId.slice(0, 8)}`}
      gapTitle="Negotiation is not built yet"
      gap={gap}
      action={
        <Link to="/account/bookings">
          <Button variant="primary">Back to my bookings</Button>
        </Link>
      }
    />
  );
}

function NegotiationDetails() {
  const { quoteId } = accountNegotiationRoute.useParams();
  return (
    <NegotiationScreen
      quoteId={quoteId}
      title="Negotiation details"
      gap="There is no negotiation in the data model: a quote is priced by the engine and accepted or not. Counter-offers, their history and the party making them have nowhere to live yet."
    />
  );
}

export const accountNegotiationRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$quoteId',
  component: NegotiationDetails,
});

function NegotiationChat() {
  const { quoteId } = accountNegotiationChatRoute.useParams();
  return (
    <NegotiationScreen
      quoteId={quoteId}
      title="Negotiation chat"
      gap="Messaging needs a thread store and a transport, neither of which exists here. Talk to the yard through the contact page until it does."
    />
  );
}

export const accountNegotiationChatRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$quoteId/chat',
  component: NegotiationChat,
});

function NegotiationCall() {
  const { quoteId } = accountNegotiationCallRoute.useParams();
  return (
    <NegotiationScreen
      quoteId={quoteId}
      title="Negotiation call"
      gap="In-app calling needs a telephony provider this product has not chosen, let alone integrated. The yard's phone number is on the contact page."
    />
  );
}

export const accountNegotiationCallRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$quoteId/call',
  component: NegotiationCall,
});

function NegotiationFinal() {
  const { quoteId } = accountNegotiationFinalRoute.useParams();
  return (
    <NegotiationScreen
      quoteId={quoteId}
      title="Negotiation finalised"
      gap="Nothing records a settled negotiation, because nothing records the negotiation. An agreed price today is a quote the yard issues and you accept."
    />
  );
}

export const accountNegotiationFinalRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/negotiation/$quoteId/final',
  component: NegotiationFinal,
});
