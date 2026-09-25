import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { quotesQueries, usersQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { formatDate, shortCode } from '../lib/format.js';
import { quoteExpiresAt } from '@arkilaunch/shared';
import { Button } from '../components/button.js';
import { QuoteLines } from '../components/quote-lines.js';

// The printable quote the API's printableUrl points at: letterhead, lines as
// the customer sees them, validity. Browser print (or Save as PDF) keeps it
// endpoint-free, like the invoice statement.
function QuotePrintPage() {
  const { quoteId } = quotePrintRoute.useParams();
  const quote = useQuery(quotesQueries.detail(quoteId));
  const me = useQuery(usersQueries.me());
  if (quote.isError) return <p className="text-sm text-error">{apiErrorText(quote.error)}</p>;
  if (!quote.data) return <p className="text-sm text-text-muted">Loading quote...</p>;
  const q = quote.data;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 bg-surface p-6 print:max-w-none print:p-0">
      <div data-print-hide className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => window.print()}>
          Print
        </Button>
        <Link to="/app/quotes">
          <Button variant="ghost">Back to quotes</Button>
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="font-display text-2xl font-semibold text-text">{me.data?.tenantName ?? ''}</p>
          <p className="text-sm text-text-muted">Equipment rental quotation</p>
        </div>
        <div className="text-right text-sm text-text">
          <p className="font-mono">{shortCode('quote', q.id)} &middot; revision {q.revision}</p>
          {q.createdAt && <p>Issued {formatDate(q.createdAt)}</p>}
          {q.createdAt && <p>Valid until {formatDate(quoteExpiresAt(q.createdAt))}</p>}
        </div>
      </header>
      {q.customerName && (
        <p className="text-sm text-text">
          <span className="text-text-muted">Prepared for </span>
          <span className="font-semibold">{q.customerName}</span>
        </p>
      )}
      <QuoteLines quote={q} />
      <p className="text-xs text-text-muted">
        Fuel priced at {q.dieselPrice.toFixed(2)} PHP per litre (as of {q.dieselPriceDate}). Prices in Philippine pesos.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm text-text">
        <div className="border-t border-text pt-1">Prepared by</div>
        <div className="border-t border-text pt-1">Accepted by (customer)</div>
      </div>
    </div>
  );
}

export const quotePrintRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/quotes/$quoteId/print',
  component: QuotePrintPage,
});
