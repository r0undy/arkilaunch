import { createRoute, Link } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Container } from '../components/container.js';
import { ExpandableSection } from '../components/expandable-section.js';
import { StatTile } from '../components/stat-tile.js';
import { MachineName } from '../components/machine-name.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button, buttonClass } from '../components/button.js';
import { PrintFrame } from '../components/print-frame.js';
import { formatDate, formatHours, formatInvoiceType, formatPeso } from '../lib/format.js';
import { CalendarRange } from 'lucide-react';

function Statement({ snapshot }: { snapshot: ReportsSnapshot }) {
  const { utilization, financial } = snapshot;
  const totalHours = utilization.fleet.reduce((sum, row) => sum + row.runtimeHours, 0);
  const invoicedTypes = Object.entries(financial.invoiced.byType);
  const period = (p: { from: string; to: string }) => `${formatDate(p.from)} – ${formatDate(p.to)}`;
  const samePeriod = financial.period.from === utilization.period.from && financial.period.to === utilization.period.to;
  const columns: TableColumn<ReportsSnapshot['utilization']['fleet'][number]>[] = [
    { header: 'Equipment', kind: 'text', cell: (row) => <MachineName equipmentId={row.equipmentId} /> },
    { header: 'EDTR hours', kind: 'number', cell: (row) => formatHours(row.runtimeHours) },
    { header: 'Utilization', kind: 'number', cell: (row) => `${row.utilizationPct.toFixed(1)}%` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PrintFrame
        title="Weekly billing rundown"
        docRef={`WBR-${financial.period.to.slice(0, 10)}`}
        issuedAt={new Date()}
        details={[
          ['Billing period', period(financial.period)],
          ['Hours period', period(utilization.period)],
          ['Total invoiced', formatPeso(financial.invoiced.total)],
          ['EDTR hours', formatHours(totalHours)],
        ]}
      />
      <Container
        header={{
          title: period(utilization.period),
          description: `${utilization.fleet.length} machine${utilization.fleet.length === 1 ? '' : 's'} on hire`,
        }}
      >
        <ExpandableSection header={<span className="text-sm font-medium">About these figures</span>}>
          <ul className="list-disc pl-5 text-sm text-text-muted">
            <li>Hours are the reconciled EDTR totals for the period, not a meter reading.</li>
            {!samePeriod && <li>Money is for the financial period {period(financial.period)}.</li>}
          </ul>
        </ExpandableSection>
      </Container>

      {/* The frame carries an hourly-rate and a line-total column per
          machine. GET /reports/utilization returns hours only, and pricing a
          line here from the rate cards would be this screen inventing a
          billed amount beside the real one on the invoice. The money below is
          the API's own total; per-line pricing stays on the invoice, which is
          the object that actually charged it. */}
      <Table
        header={{ title: 'Equipment usage', count: utilization.fleet.length }}
        columns={columns}
        rows={utilization.fleet}
        rowKey={(row) => row.equipmentId}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <StatTile label="Total EDTR hours" value={formatHours(totalHours)} hint="Across every machine this period." />
        <Container header={{ title: 'Invoiced' }}>
          <dl className="flex flex-col gap-3 text-sm">
            {invoicedTypes.map(([type, amount]) => (
              <div key={type} className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">{formatInvoiceType(type)}</dt>
                <dd className="font-mono tabular-nums text-text">{formatPeso(amount)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Paid</dt>
              <dd className="font-mono tabular-nums text-text">{formatPeso(financial.paid)}</dd>
            </div>
            {/* `depositDeducted` is not a separate charge -- it is the same
                money `invoiced.byType.deposit_deduction` already itemises
                above. Live QA showed both lines rendering PHP 37,187.50 under
                near-identical labels ("Deposit deduction" and "Deposit
                deducted"), which reads as the customer being charged twice.
                Show it only if the breakdown above did not already account
                for it. */}
            {financial.depositDeducted > 0 && !('deposit_deduction' in financial.invoiced.byType) && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Deposit deducted</dt>
                <dd className="font-mono tabular-nums text-text">{formatPeso(financial.depositDeducted)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <dt className="text-base font-medium text-text">Total invoiced</dt>
              <dd className="font-mono text-heading-md tabular-nums text-text">{formatPeso(financial.invoiced.total)}</dd>
            </div>
          </dl>
        </Container>
      </div>
    </div>
  );
}

function WeeklyBillingPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Weekly billing rundown"
        description="Hours run against money invoiced, for the current reporting period."
        actions={
          <>
            <Link to="/app/payments" className={buttonClass('ghost')}>Back</Link>
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
        emptyIcon={CalendarRange}
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
