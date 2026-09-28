import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { accountLayoutRoute } from './_account.js';
import { Button } from '../components/button.js';
import { PageHeader } from '../components/page-header.js';
import { Modal } from '../components/modal.js';
import { hasRequiredCompanyDocuments } from '@arkilaunch/shared';
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
  const hasDocs = companies.some((c) => hasRequiredCompanyDocuments(c.documents));
  return [
    { label: 'Add your company', done: companies.length > 0, to: '/account/companies/new' },
    { label: 'Upload its ID and registration', done: hasDocs, to: '/account/companies' },
    { label: 'Add a project site', done: siteCount > 0, to: '/account/companies' },
    {
      label: 'Get verified by the rental team',
      done: companies.some((c) => c.kycStatus === 'approved'),
      to: '/account/companies',
    },
  ];
}

const SEEN_KEY = 'setup-modal-seen';

// Pops up on the first home visit of each session until setup is done;
// after that the home page only carries a one-line reminder that reopens it.
function SetupChecklist() {
  const companies = useQuery(companiesQueries.mine());
  const sites = useQuery(customerSitesQueries.mine());
  const [open, setOpen] = useState(() => {
    try {
      return !sessionStorage.getItem(SEEN_KEY);
    } catch {
      return true;
    }
  });
  const close = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Storage blocked: it simply pops up again next visit.
    }
    setOpen(false);
  };
  if (!companies.data || !sites.data) return null;
  const steps = setupSteps(companies.data, sites.data.length);
  const todo = steps.filter((step) => !step.done);
  const next = todo[0];
  if (!next) return null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="relative flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left text-sm text-text hover:border-accent"
      >
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-xs font-bold text-white"
        >
          !
        </span>
        <span>
          <span className="font-semibold">
            {todo.length} step{todo.length === 1 ? '' : 's'} left
          </span>{' '}
          <span className="text-text-muted">before you can pay for bookings</span>
        </span>
        <span aria-hidden="true" className="text-accent">
          ›
        </span>
      </button>
      <Modal
        open={open}
        onClose={close}
        size="sm"
        title="Before your first booking"
        description="You can request quotes any time; payment opens once your company is verified."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Later
            </Button>
            <Link to={next.to} onClick={close}>
              <Button variant="primary">{next.label}</Button>
            </Link>
          </>
        }
      >
        <StepList steps={steps} onNavigate={close} />
      </Modal>
    </>
  );
}

function StepList({ steps, onNavigate }: { steps: SetupStep[]; onNavigate: () => void }) {
  return (
    <ol className="flex flex-col gap-2">
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
            <Link to={step.to} onClick={onNavigate} className="text-accent underline">
              {step.label}
            </Link>
          )}
          <span className="sr-only">{step.done ? '(done)' : '(to do)'}</span>
        </li>
      ))}
    </ol>
  );
}

function AccountHomePage() {
  const { data: bookings } = useQuery(bookingsQueries.list());
  const activeCount =
    bookings?.items.filter((b) => b.status !== 'cancelled' && b.status !== 'completed').length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Home"
        description={
          activeCount > 0
            ? `${activeCount} active booking${activeCount === 1 ? '' : 's'}, and what to do next.`
            : 'Your bookings, companies and what to do next.'
        }
      />
      <SetupChecklist />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-6">
          <h2 className="text-heading-md text-text">Rent equipment</h2>
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
          <h2 className="text-heading-md text-text">Your bookings</h2>
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
