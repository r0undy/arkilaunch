import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { invoicesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function PaymentsPage() {
  return (
    <DataPanel
      title="Payments"
      options={invoicesQueries.list()}
      emptyTitle="No invoices yet"
      emptyDescription="Invoices appear once a reconciliation is approved and a deduction is posted."
      isEmpty={(data) => data.length === 0}
      render={(data) => (
        <Surface radius="md" elevation="sm" className="p-4">
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data, null, 2)}</pre>
        </Surface>
      )}
    />
  );
}

export const appPaymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/payments',
  component: PaymentsPage,
});
