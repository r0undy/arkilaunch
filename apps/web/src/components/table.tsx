import { Fragment, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Surface } from './surface.js';

/**
 * What a column holds, which decides its alignment everywhere (DSD §8):
 * text and dates read left, numbers and money right in mono, status pills
 * and row actions centered. Header and cells always share the alignment,
 * so no table can drift from the rule.
 */
export type ColumnKind = 'text' | 'date' | 'number' | 'money' | 'status' | 'action';

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  kind: ColumnKind;
  /**
   * A fixed width (any CSS length). Tables rendered as siblings (the field
   * logs, one per rental) give every column a width so they line up.
   */
  width?: string;
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
  /** Opt-in: a row can open in place to show what sits under it. */
  renderExpanded?: (row: T) => ReactNode;
  /** Accessible name for the expand toggle, e.g. "Show equipment at Site A". */
  expandLabel?: (row: T) => string;
  /** Under the rows, inside the same card: the Pagination bar. */
  footer?: ReactNode;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
}

export function columnAlign(kind: ColumnKind): 'left' | 'right' | 'center' {
  if (kind === 'number' || kind === 'money') return 'right';
  if (kind === 'status' || kind === 'action') return 'center';
  return 'left';
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function cellClass(kind: ColumnKind): string {
  return [
    'px-4 py-2.5 align-middle',
    ALIGN_CLASS[columnAlign(kind)],
    kind === 'number' || kind === 'money' ? 'font-mono tabular-nums' : '',
    kind === 'date' ? 'whitespace-nowrap tabular-nums' : '',
    kind === 'status' || kind === 'action' ? 'whitespace-nowrap' : '',
  ].join(' ');
}

// Console-tier list primitive (DSD §8: tight radii, no backdrop-filter).
// Rows stay 44px+; the table scrolls sideways inside its own card, never
// the page.
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  renderExpanded,
  expandLabel,
  footer,
  empty,
}: TableProps<T>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fixed = columns.some((c) => c.width);
  const span = columns.length + (onRowClick ? 1 : 0) + (renderExpanded ? 1 : 0);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Surface radius="md" elevation="sm" className="relative overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className={['w-full text-sm text-text', fixed ? 'table-fixed' : ''].join(' ')}>
          {fixed && (
            <colgroup>
              {renderExpanded && <col style={{ width: '3rem' }} />}
              {columns.map((col, i) => (
                <col key={i} {...(col.width ? { style: { width: col.width } } : {})} />
              ))}
              {onRowClick && <col style={{ width: '3rem' }} />}
            </colgroup>
          )}
          <thead className="bg-surface-sunk">
            <tr className="border-b border-border">
              {renderExpanded && (
                <th scope="col" className="w-12 px-2">
                  <span className="sr-only">Expand</span>
                </th>
              )}
              {columns.map((col, i) => (
                <th
                  key={i}
                  scope="col"
                  className={[
                    'whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-text-muted',
                    ALIGN_CLASS[columnAlign(col.kind)],
                  ].join(' ')}
                >
                  {col.header || <span className="sr-only">Actions</span>}
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
            {rows.map((row) => {
              const key = rowKey(row);
              const isOpen = expanded.has(key);
              return (
                <Fragment key={key}>
                  <tr
                    className={[
                      'h-11 border-b border-border last:border-0',
                      onRowClick ? 'group cursor-pointer hover:bg-surface-sunk' : '',
                    ].join(' ')}
                    {...(onRowClick
                      ? {
                          onClick: (event: MouseEvent) => {
                            // Links and buttons inside a cell keep their own job.
                            if ((event.target as HTMLElement).closest('a,button,input,select,label')) return;
                            onRowClick(row);
                          },
                        }
                      : {})}
                  >
                    {renderExpanded && (
                      <td className="px-2 text-center">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggle(key)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        >
                          {isOpen ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
                          <span className="sr-only">{expandLabel ? expandLabel(row) : 'Show details'}</span>
                        </button>
                      </td>
                    )}
                    {columns.map((col, i) => (
                      <td key={i} className={cellClass(col.kind)}>
                        {col.cell(row)}
                      </td>
                    ))}
                    {onRowClick && (
                      <td className="px-2 text-center">
                        {/* The row itself is not focusable -- a <tr> with a click
                            handler is invisible to the keyboard, so the actual
                            control lives here and the row click is the shortcut. */}
                        <button
                          type="button"
                          onClick={() => onRowClick(row)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-muted group-hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        >
                          <ChevronRight aria-hidden className="h-4 w-4" />
                          <span className="sr-only">{rowLabel ? rowLabel(row) : 'View'}</span>
                        </button>
                      </td>
                    )}
                  </tr>
                  {renderExpanded && isOpen && (
                    <tr className="border-b border-border bg-surface-sunk/60 last:border-0">
                      <td colSpan={span} className="px-4 py-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </Surface>
  );
}
