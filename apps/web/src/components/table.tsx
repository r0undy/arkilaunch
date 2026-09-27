import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Surface } from './surface.js';

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /**
   * Opt-in: makes each row activate, for lists whose rows have more behind
   * them than the columns show. Rows stay plain `<tr>`s without it.
   */
  onRowClick?: (row: T) => void;
  /** Accessible name for an activated row, e.g. "Open invoice INV-8f2a". */
  rowLabel?: (row: T) => string;
  /** Under the rows, inside the same card: the Pagination bar. */
  footer?: ReactNode;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
}

// Console-tier list primitive (DSD §8: tight radii, no backdrop-filter).
// Rows stay 44px+ and numbers right-aligned in mono; the table scrolls
// sideways inside its own card, never the page.
export function Table<T>({ columns, rows, rowKey, onRowClick, rowLabel, footer, empty }: TableProps<T>) {
  const span = columns.length + (onRowClick ? 1 : 0);
  return (
    <Surface radius="md" elevation="sm" className="relative overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-text">
          <thead className="bg-surface-sunk">
            <tr className="border-b border-border text-left">
              {columns.map((col) => (
                <th
                  key={col.header}
                  scope="col"
                  className={[
                    'whitespace-nowrap px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  ].join(' ')}
                >
                  {col.header}
                </th>
              ))}
              {onRowClick && (
                <th scope="col" className="w-10 px-2">
                  <span className="sr-only">Open</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && empty && (
              <tr>
                <td colSpan={span} className="px-4 py-8 text-center text-text-muted">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={[
                  'h-11 border-b border-border last:border-0',
                  onRowClick ? 'group cursor-pointer hover:bg-surface-sunk' : '',
                ].join(' ')}
                {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
              >
                {columns.map((col) => (
                  <td
                    key={col.header}
                    className={['px-4 py-2.5', col.align === 'right' ? 'text-right font-mono tabular-nums' : ''].join(' ')}
                  >
                    {col.cell(row)}
                  </td>
                ))}
                {onRowClick && (
                  <td className="px-2 text-right">
                    {/* The row itself is not focusable -- a <tr> with a click
                        handler is invisible to the keyboard, so the actual
                        control lives here and the row click is the shortcut. */}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRowClick(row);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-muted group-hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <ChevronRight aria-hidden className="h-4 w-4" />
                      <span className="sr-only">{rowLabel ? rowLabel(row) : 'View'}</span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </Surface>
  );
}
