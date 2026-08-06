import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-client.js';
import { Surface } from './surface.js';
import { EmptyState } from './empty-state.js';
import { Button } from './button.js';

export interface DataPanelProps<T, TQueryKey extends QueryKey = QueryKey> {
  title: string;
  options: UseQueryOptions<T, Error, T, TQueryKey>;
  emptyTitle: string;
  emptyDescription: string;
  isEmpty: (data: T) => boolean;
  render: (data: T) => ReactNode;
}

// Shared loading/error/success/empty wrapper (DESIGN.md §4.1) for the
// admin-console screens with a live GET endpoint but no bespoke UI yet.
// Backed by TanStack Query: the query key (not a fetcher function identity)
// is what determines re-fetch behavior, so a call site passing a fresh
// options object literal on every render (the previous fetcher-prop shape's
// bug) no longer causes a refetch loop.
export function DataPanel<T, TQueryKey extends QueryKey = QueryKey>({
  title,
  options,
  emptyTitle,
  emptyDescription,
  isEmpty,
  render,
}: DataPanelProps<T, TQueryKey>) {
  const query = useQuery(options);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">{title}</h1>
      {query.isPending && <p className="text-sm text-text-muted">Loading...</p>}
      {query.isError && (
        <Surface radius="md" elevation="sm" className="flex flex-col gap-3 border-error p-4">
          <p className="text-sm text-error">
            {query.error instanceof ApiError && query.error.status === 403
              ? `You do not have permission to view ${title.toLowerCase()}.`
              : `Could not load ${title.toLowerCase()}. Is the API running?`}
          </p>
          <Button variant="secondary" onClick={() => query.refetch()}>
            Retry
          </Button>
        </Surface>
      )}
      {query.isSuccess && (isEmpty(query.data) ? <EmptyState title={emptyTitle} description={emptyDescription} /> : render(query.data))}
    </div>
  );
}
