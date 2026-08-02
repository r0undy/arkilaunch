import { useEffect, useState, type ReactNode } from 'react';
import { Surface } from './surface.js';
import { EmptyState } from './empty-state.js';

export interface DataPanelProps<T> {
  title: string;
  fetcher: () => Promise<T>;
  emptyTitle: string;
  emptyDescription: string;
  isEmpty: (data: T) => boolean;
  render: (data: T) => ReactNode;
}

// Shared loading/error/success/empty wrapper (DESIGN.md §4.1) for the
// admin-console screens with a live GET endpoint but no bespoke UI yet.
export function DataPanel<T>({ title, fetcher, emptyTitle, emptyDescription, isEmpty, render }: DataPanelProps<T>) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'success'; data: T }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">{title}</h1>
      {state.status === 'loading' && <p className="text-sm text-text-muted">Loading...</p>}
      {state.status === 'error' && (
        <Surface radius="md" elevation="sm" className="border-error p-4">
          <p className="text-sm text-error">Could not load {title.toLowerCase()}. Is the API running?</p>
        </Surface>
      )}
      {state.status === 'success' && (isEmpty(state.data) ? <EmptyState title={emptyTitle} description={emptyDescription} /> : render(state.data))}
    </div>
  );
}
