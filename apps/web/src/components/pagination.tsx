import { Button } from './button.js';

// Every list in the console rendered its whole result set. The API caps a
// page at 100 rows, so a long list was not just unreadable -- it was silently
// truncated with nothing on screen to say so.

export const PAGE_SIZE = 20;

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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-sm text-text-muted" aria-live="polite">
        {/* The range, not just the page number: "showing 21-40 of 63" answers
            "where am I" and "how much is there" in one line. */}
        Showing {first.toLocaleString('en-PH')}-{last.toLocaleString('en-PH')} of{' '}
        {total.toLocaleString('en-PH')} {noun}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">
          Page {page} of {pages}
        </span>
        <Button
          variant="secondary"
          size="field"
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          disabled={!canGoBack || busy}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="field"
          onClick={() => onOffsetChange(offset + limit)}
          disabled={!canGoForward || busy}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
