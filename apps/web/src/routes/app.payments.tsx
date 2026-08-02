import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { apiGet } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function PaymentsPage() {
  return (
    <DataPanel<unknown[]>
      title="Payments"
      fetcher={() => apiGet<unknown[]>('/invoices')}
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
