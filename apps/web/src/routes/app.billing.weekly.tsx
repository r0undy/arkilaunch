import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { equipmentQueries, reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { formatHours, formatInvoiceType, formatPeso, shortCode } from '../lib/format.js';

// The utilization report identifies a unit only by id, same as the Insights
// screen -- look the machine up in the fleet list that screen already caches
// rather than printing a UUID stub in the column a yard manager reads first.
function MachineName({ equipmentId }: { equipmentId: string }) {
  const fleet = useQuery(equipmentQueries.list());
  const match = fleet.data?.items.find((item) => item.id === equipmentId);
  if (!match)
    return <span className="font-mono text-xs text-text-muted">{shortCode('equipment', equipmentId)}</span>;
  return (
    <span className="flex flex-col">
      <span className="font-semibold text-text">{match.model}</span>
      <span className="font-mono text-xs text-text-muted">{match.serialNo}</span>
    </span>
  );
}

function Statement({ snapshot }: { snapshot: ReportsSnapshot }) {
  const { utilization, financial } = snapshot;
  const totalHours = utilization.fleet.reduce((sum, row) => sum + row.runtimeHours, 0);
  const invoicedTypes = Object.entries(financial.invoiced.byType);

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-8 p-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="border-b border-border pb-1 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Billing period
          </h2>
          <p className="pt-2 font-display text-lg font-semibold uppercase text-text">
            {utilization.period.from} to {utilization.period.to}
          </p>
          <p className="text-sm text-text-muted">
            Hours are the reconciled EDTR totals for the period, not a meter reading.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="border-b border-border pb-1 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Fleet provider
          </h2>
          <p className="pt-2 font-display text-lg font-semibold uppercase text-text">
            {utilization.fleet.length} machine{utilization.fleet.length === 1 ? '' : 's'} on hire
          </p>
          <p className="text-sm text-text-muted">
            Financial period {financial.period.from} to {financial.period.to}.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold uppercase text-text">
          Itemized equipment usage
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-text bg-surface-sunk text-left">
                <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text">
                  Equipment
                </th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-[0.04em] text-text">
                  EDTR hours
                </th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-[0.04em] text-text">
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody>
              {utilization.fleet.map((row) => (
                <tr key={row.equipmentId} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <MachineName equipmentId={row.equipmentId} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text">
                    {formatHours(row.runtimeHours)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text">
                    {row.utilizationPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* The frame carries an hourly-rate and a line-total column per
            machine. GET /reports/utilization returns hours only, and pricing
            a line here from the rate cards would be this screen inventing a
            billed amount beside the real one on the invoice. The money below
            is the API's own total; per-line pricing stays on the invoice,
            which is the object that actually charged it. */}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-6">
        <Surface radius="md" elevation="sm" className="flex flex-col gap-1 bg-surface-sunk p-4">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Weekly utilization metric
          </p>
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text">
              {formatHours(totalHours)}
            </span>
            <span className="font-display text-sm font-semibold text-text">total EDTR hours</span>
          </p>
        </Surface>

        <div className="flex w-full max-w-xs flex-col gap-3">
          {invoicedTypes.map(([type, amount]) => (
            <div key={type} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-muted">{formatInvoiceType(type)}</span>
              <span className="font-mono text-text">{formatPeso(amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-muted">Paid</span>
            <span className="font-mono text-text">{formatPeso(financial.paid)}</span>
          </div>
          {/* `depositDeducted` is not a separate charge -- it is the same
              money `invoiced.byType.deposit_deduction` already itemises
              above. Live QA showed both lines rendering PHP 37,187.50 under
              near-identical labels ("Deposit deduction" and "Deposit
              deducted"), which reads as the customer being charged twice.
              Show it only if the breakdown above did not already account
              for it. */}
          {financial.depositDeducted > 0 && !('deposit_deduction' in financial.invoiced.byType) && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-muted">Deposit deducted</span>
              <span className="font-mono text-text">{formatPeso(financial.depositDeducted)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-text pt-3">
            <span className="font-display text-base font-semibold uppercase text-text">
              Total invoiced
            </span>
            <span className="font-mono text-lg font-semibold text-text">
              {formatPeso(financial.invoiced.total)}
            </span>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function WeeklyBillingPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Weekly billing rundown"
        description="Hours run against money invoiced, for the current reporting period."
        actions={
          <>
            <Link to="/app/payments">
              <Button variant="ghost">Back</Button>
            </Link>
            <Button variant="secondary" onClick={() => window.print()}>
              Print statement
            </Button>
          </>
        }
      />
      <DataPanel
        title="Weekly rundown"
        options={reportQueries.snapshot()}
        emptyTitle="Nothing billed this period"
        emptyDescription="No machine recorded hours and no invoice was raised in the reporting window."
        isEmpty={(data) => data.utilization.fleet.length === 0 && data.financial.invoiced.total === 0}
        render={(data) => <Statement snapshot={data} />}
      />
    </div>
  );
}

export const appBillingWeeklyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/billing/weekly',
  component: WeeklyBillingPage,
});
