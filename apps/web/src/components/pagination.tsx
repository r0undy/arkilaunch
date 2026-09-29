import { ChevronLeft, ChevronRight } from 'lucide-react';

// Every list in the console rendered its whole result set. The API caps a
// page at 100 rows, so a long list was not just unreadable -- it was silently
// truncated with nothing on screen to say so.

export { PAGE_SIZE } from '../lib/queries.js';

export interface PaginationProps {
  /** Zero-based index of the first row on this page. */
  offset: number;
  limit: number;
  /** Total rows matching the query, not the number on this page. */
  total: number;
  onOffsetChange: (offset: number) => void;
  /** Plural noun for the rows, e.g. "field logs". */
  noun: string;
  busy?: boolean;
}

// Page numbers to show: always the first, last and the current page's
// neighbours, with null marking a gap ("1 … 4 5 6 … 50").
export function pageWindow(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) out.push(n);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

export function Pagination({
  offset,
  limit,
  total,
  onOffsetChange,
  noun,
  busy = false,
}: PaginationProps) {
  // One page of results needs no controls; showing them implies there is
  // somewhere else to go.
  if (total <= limit) return null;

  const first = offset + 1;
  const last = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const canGoBack = offset > 0;
  const canGoForward = offset + limit < total;

  const arrow =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text hover:bg-surface-sunk disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring';

  // AWS Console table paging: the range, then ‹ page numbers ›, compact enough
  // for a container toolbar.
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <p className="text-sm text-text-muted" aria-live="polite">
        {/* The range, not just the page number: "showing 21-40 of 63" answers
            "where am I" and "how much is there" in one line. */}
        Showing {first.toLocaleString('en-PH')}-{last.toLocaleString('en-PH')} of{' '}
        {total.toLocaleString('en-PH')} {noun}
      </p>
      <div className="flex items-center">
        <button type="button" className={arrow} onClick={() => onOffsetChange(Math.max(0, offset - limit))} disabled={!canGoBack || busy}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
          <span className="sr-only">Previous</span>
        </button>
        <nav aria-label={`Pages of ${noun}`} className="flex items-center">
          {pageWindow(page, pages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-sm text-text-muted">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                aria-label={`Page ${n} of ${pages}`}
                aria-current={n === page ? 'page' : undefined}
                disabled={busy}
                onClick={() => onOffsetChange((n - 1) * limit)}
                className={[
'min-h-11 min-w-9 rounded-sm px-2 text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring',
                  n === page ? 'font-semibold text-text underline decoration-primary decoration-2 underline-offset-8' : 'text-text-muted hover:bg-surface-sunk hover:text-text',
                ].join(' ')}
              >
                {n}
              </button>
            ),
          )}
        </nav>
        <button type="button" className={arrow} onClick={() => onOffsetChange(offset + limit)} disabled={!canGoForward || busy}>
          <ChevronRight aria-hidden className="h-4 w-4" />
          <span className="sr-only">Next</span>
        </button>
      </div>
    </div>
  );
}
