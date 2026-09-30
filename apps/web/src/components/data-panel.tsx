import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-client.js';
import { LoadError } from './load-error.js';
import { EmptyState } from './empty-state.js';
import { Container } from './container.js';
import { Skeleton } from './skeleton.js';

export interface DataPanelProps<T, TQueryKey extends QueryKey = QueryKey> {
  title: string;
  options: UseQueryOptions<T, Error, T, TQueryKey>;
  emptyTitle: string;
  emptyDescription: string;
  isEmpty: (data: T) => boolean;
  render: (data: T) => ReactNode;
  emptyAction?: ReactNode;
}

export function DataPanel<T, TQueryKey extends QueryKey = QueryKey>({
  title,
  options,
  emptyTitle,
  emptyDescription,
  isEmpty,
  render,
  emptyAction,
}: DataPanelProps<T, TQueryKey>) {
  const query = useQuery(options);

  return (
    <div className="flex flex-col gap-4">
      {/* No <h1>: PageHeader already renders one. */}
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
          // Cloudscape: an empty collection keeps its container and header, e.g. "Incidents (0)".
          <Container flush header={{ title, count: 0 }}>
            <EmptyState bare title={emptyTitle} description={emptyDescription} action={emptyAction} />
          </Container>
        ) : (
          render(query.data)
        ))}
    </div>
  );
}
