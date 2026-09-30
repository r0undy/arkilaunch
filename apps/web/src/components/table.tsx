import { Fragment, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Container, type ContainerHeaderProps } from './container.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { Skeleton } from './skeleton.js';

export type ColumnKind = 'text' | 'date' | 'number' | 'money' | 'status' | 'action';

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  kind: ColumnKind;
  width?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  renderExpanded?: (row: T) => ReactNode;
  expandLabel?: (row: T) => string;
  header?: ContainerHeaderProps;
  footer?: ReactNode;
  empty?: ReactNode;
  /** First load: pulse rows in place of `empty`. */
  loading?: boolean;
  cardUntil?: number;
}

export function columnAlign(kind: ColumnKind): 'left' | 'right' | 'center' {
  if (kind === 'number' || kind === 'money') return 'right';
  if (kind === 'status' || kind === 'action') return 'center';
  return 'left';
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function cellClass(kind: ColumnKind): string {
  return [
    'px-4 py-3 align-middle',
    ALIGN_CLASS[columnAlign(kind)],
    kind === 'number' || kind === 'money' ? 'font-mono tabular-nums' : '',
    kind === 'date' ? 'whitespace-nowrap tabular-nums' : '',
    kind === 'status' || kind === 'action' ? 'whitespace-nowrap' : '',
  ].join(' ');
}

function RowCards<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  renderExpanded,
  expandLabel,
  empty,
  expanded,
  toggle,
}: Omit<TableProps<T>, 'header' | 'footer'> & { expanded: Set<string>; toggle: (key: string) => void }) {
  const title = columns.find((c) => c.kind === 'text') ?? columns[0];
  const status = columns.find((c) => c.kind === 'status');
  const actions = columns.filter((c) => c.kind === 'action' && c !== title);
  const pairs = columns.filter((c) => c !== title && c !== status && !actions.includes(c));

  if (rows.length === 0) return empty ? <div className="px-4 py-8 text-center text-sm text-text-muted">{empty}</div> : null;
  return (
    <ul className="text-sm text-text">
      {rows.map((row) => {
        const key = rowKey(row);
        const isOpen = expanded.has(key);
        return (
          <li
            key={key}
            className={['border-b border-border px-4 py-3 last:border-0', onRowClick ? 'cursor-pointer' : ''].join(' ')}
            {...(onRowClick
              ? {
                  onClick: (event: MouseEvent) => {
                    if ((event.target as HTMLElement).closest('a,button,input,select,label,summary')) return;
                    onRowClick(row);
                  },
                }
              : {})}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words font-medium">{title?.cell(row)}</div>
              <div className="flex shrink-0 items-center gap-1">
                {status?.cell(row)}
                {onRowClick && (
                  <button
                    type="button"
                    onClick={() => onRowClick(row)}
                    className="-my-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <ChevronRight aria-hidden className="h-4 w-4" />
                    <span className="sr-only">{rowLabel ? rowLabel(row) : 'View'}</span>
                  </button>
                )}
              </div>
            </div>
            {pairs.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                {pairs.map((col, i) => (
                  <div key={i} className="min-w-0">
                    <dt className="text-xs text-text-muted">{col.header}</dt>
                    <dd
                      className={[
'break-words',
                        col.kind === 'number' || col.kind === 'money' ? 'font-mono tabular-nums' : '',
                      ].join(' ')}
                    >
                      {col.cell(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {actions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {actions.map((col, i) => (
                  <Fragment key={i}>{col.cell(row)}</Fragment>
                ))}
              </div>
            )}
            {renderExpanded && (
              <>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(key)}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {isOpen ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
                  {expandLabel ? expandLabel(row) : 'Show details'}
                </button>
                {isOpen && <div className="mt-2 rounded-sm bg-surface-sunk/60 p-3">{renderExpanded(row)}</div>}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Table<T>(props: TableProps<T>) {
  const { columns, rows, rowKey, onRowClick, rowLabel, renderExpanded, expandLabel, header, footer } = props;
  const empty = props.loading ? <Skeleton label="Loading" rows={3} className="[&>div]:h-10" /> : props.empty;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const narrow = useMediaQuery(`(max-width: ${props.cardUntil ?? 767}px)`);
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

  if (narrow) {
    return (
      <Container header={header} footer={footer} flush>
        <RowCards {...props} empty={empty} expanded={expanded} toggle={toggle} />
      </Container>
    );
  }

  return (
    <Container header={header} footer={footer} flush>
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
          <thead className="bg-surface">
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
'whitespace-nowrap px-4 py-3 text-sm font-medium text-text',
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
                        {/* A <tr> click is invisible to the keyboard: the real control lives here. */}
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
    </Container>
  );
}
