import type { ReactNode } from 'react';
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
}

// Console-tier list primitive (DSD §8: tight radii, no backdrop-filter):
// replaces the raw `JSON.stringify` placeholder DataPanel's callers used
// before real backend response shapes existed. Deliberately minimal --
// sorting/pagination/filtering are not part of this pass.
export function Table<T>({ columns, rows, rowKey, onRowClick, rowLabel }: TableProps<T>) {
  return (
    <Surface radius="md" elevation="sm" className="overflow-x-auto p-0">
      <table className="w-full text-sm text-text">
        <thead>
          <tr className="border-b border-border text-left text-text-muted">
            {columns.map((col) => (
              <th
                key={col.header}
                className={['px-4 py-3 font-medium', col.align === 'right' ? 'text-right' : 'text-left'].join(' ')}
              >
                {col.header}
              </th>
            ))}
            {onRowClick && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={[
                'border-b border-border last:border-0',
                onRowClick ? 'cursor-pointer hover:bg-surface-sunk' : '',
              ].join(' ')}
              {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
            >
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={['px-4 py-3', col.align === 'right' ? 'text-right font-mono tabular-nums' : ''].join(' ')}
                >
                  {col.cell(row)}
                </td>
              ))}
              {onRowClick && (
                <td className="px-4 py-3 text-right">
                  {/* The row itself is not focusable -- a <tr> with a click
                      handler is invisible to the keyboard, so the actual
                      control lives here and the row click is the shortcut. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRowClick(row);
                    }}
                    className="rounded-sm font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    View
                    {rowLabel && <span className="sr-only"> {rowLabel(row)}</span>}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}
