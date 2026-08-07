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
}

// Console-tier list primitive (DSD §8: tight radii, no backdrop-filter):
// replaces the raw `JSON.stringify` placeholder DataPanel's callers used
// before real backend response shapes existed. Deliberately minimal --
// sorting/pagination/filtering are not part of this pass.
export function Table<T>({ columns, rows, rowKey }: TableProps<T>) {
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
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border last:border-0">
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={['px-4 py-3', col.align === 'right' ? 'text-right font-mono tabular-nums' : ''].join(' ')}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}
