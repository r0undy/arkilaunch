import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ApiError } from '../lib/api-client.js';
import { LoadError } from './load-error.js';
import { EmptyState } from './empty-state.js';
import { Skeleton } from './skeleton.js';

export interface DataPanelProps<T, TQueryKey extends QueryKey = QueryKey> {
  title: string;
  options: UseQueryOptions<T, Error, T, TQueryKey>;
  emptyTitle: string;
  emptyDescription: string;
  isEmpty: (data: T) => boolean;
  render: (data: T) => ReactNode;
  emptyIcon?: LucideIcon;
  // The next step from an empty list, e.g. an "Add" button.
  emptyAction?: ReactNode;
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
  emptyIcon,
  emptyAction,
}: DataPanelProps<T, TQueryKey>) {
  const query = useQuery(options);

  return (
    <div className="flex flex-col gap-4">
      {/* No <h1> here. Every screen already renders one through PageHeader,
          and rendering a second produced the visible duplicate title -- and
          two competing document outlines for a screen reader. `title` is
          still used to word the states below. */}
      {query.isPending && <Skeleton label={`Loading ${title.toLowerCase()}`} />}
      {query.isError && (
        <LoadError
          message={
            query.error instanceof ApiError && query.error.status === 403
              ? `You do not have permission to view ${title.toLowerCase()}.`
              : `${title} could not be loaded just now. Check your connection and try again.`
          }
          onRetry={() => query.refetch()}
        />
      )}
      {query.isSuccess &&
        (isEmpty(query.data) ? (
          <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} action={emptyAction} />
        ) : (
          render(query.data)
        ))}
    </div>
  );
}
