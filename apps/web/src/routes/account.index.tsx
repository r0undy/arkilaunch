import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { accountLayoutRoute } from './_account.js';
import { Button } from '../components/button.js';
import { bookingsQueries, companiesQueries, customerSitesQueries } from '../lib/queries.js';
import { CheckIcon } from '../components/icons.js';

export interface SetupStep {
  label: string;
  done: boolean;
  to: string;
}

// What a new customer still has to do before a booking can be paid. Each
// step is derived from the records, not a stored flag.
export function setupSteps(
  companies: { kycStatus: string; documents: { documentType: string }[] }[],
  siteCount: number,
): SetupStep[] {
  const hasDocs = companies.some(
    (c) => c.documents.some((d) => d.documentType === 'government_id') && c.documents.some((d) => d.documentType === 'company_registration'),
  );
  return [
    { label: 'Add your company', done: companies.length > 0, to: '/account/companies/new' },
    { label: 'Upload its ID and registration', done: hasDocs, to: '/account/companies' },
    { label: 'Add a project site', done: siteCount > 0, to: '/account/companies' },
    { label: 'Get verified by the rental team', done: companies.some((c) => c.kycStatus === 'approved'), to: '/account/companies' },
  ];
}

function SetupChecklist() {
  const companies = useQuery(companiesQueries.mine());
  const sites = useQuery(customerSitesQueries.mine());
  if (!companies.data || !sites.data) return null;
  const steps = setupSteps(companies.data, sites.data.length);
  if (steps.every((step) => step.done)) return null;
  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h2 className="font-display text-base font-semibold text-text">Before your first booking</h2>
      <p className="mt-1 text-sm text-text-muted">You can request quotes any time; payment opens once your company is verified.</p>
      <ol className="mt-4 flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={[
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                step.done ? 'border-success bg-success text-white' : 'border-border text-text-muted',
              ].join(' ')}
            >
              {step.done ? <CheckIcon /> : null}
            </span>
            {step.done ? (
              <span className="text-text-muted line-through">{step.label}</span>
            ) : (
              <Link to={step.to} className="text-accent underline">
                {step.label}
              </Link>
            )}
            <span className="sr-only">{step.done ? '(done)' : '(to do)'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AccountHomePage() {
  const { data: bookings } = useQuery(bookingsQueries.list());
  const activeCount =
    bookings?.items.filter((b) => b.status !== 'cancelled' && b.status !== 'completed').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text">Your account</h1>
        <p className="text-sm text-text-muted">
          {activeCount > 0
            ? `${activeCount} active booking${activeCount === 1 ? '' : 's'}.`
            : 'Manage your active operations and equipment status.'}
        </p>
      </div>
      <SetupChecklist />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-6">
          <h2 className="font-display text-base font-semibold text-text">Rent equipment</h2>
          <p className="mt-1 text-sm text-text-muted">
            Browse the fleet and book equipment for your project.
          </p>
          <Link to="/equipment">
            <Button variant="primary" className="mt-4">
              Browse equipments
            </Button>
          </Link>
        </div>
        <div className="rounded-md border border-border bg-surface p-6">
          <h2 className="font-display text-base font-semibold text-text">Your bookings</h2>
          <p className="mt-1 text-sm text-text-muted">
            View active rentals and their return dates.
          </p>
          <Link to="/account/bookings">
            <Button variant="secondary" className="mt-4">
              View bookings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export const accountIndexRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account',
  component: AccountHomePage,
});
