import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import type { NotificationListResponse, NotificationResponse } from '@arkilaunch/shared';
import { apiGet, apiPatch } from '../lib/api-client.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { BellIcon } from './icons.js';
import { formatRelativeTime } from '../lib/format-time.js';
import { formatStatus, shortCode } from '../lib/format.js';

export const notificationQueries = {
  list: (limit = 20, offset = 0) =>
    queryOptions({
      queryKey: ['notifications', limit, offset] as const,
      queryFn: () =>
        apiGet<NotificationListResponse>(`/notifications?limit=${limit}&offset=${offset}`),
    }),
};

// The payload column is typed `unknown` in the shared schema on purpose --
// each notification type writes its own shape, and the only current writer
// (jobs/src/maintenance-notify.ts) stores equipment_id/threshold/
// runtime_hours. Read it defensively: an unrecognised payload still renders
// its type, time and read state rather than crashing the feed or, worse,
// printing "[object Object]".
function payloadLines(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && typeof value !== 'object')
    .map(([key, value]) => {
      const label = formatStatus(key);
      if (key.endsWith('_id') && typeof value === 'string') {
        return `${label}: ${shortCode('equipment', value)}`;
      }
      return `${label}: ${String(value)}`;
    });
}

function NotificationRow({ notification }: { notification: NotificationResponse }) {
  const queryClient = useQueryClient();
  const isUnread = notification.status === 'unread';
  const when = formatRelativeTime(new Date(notification.createdAt).toISOString());

  const markRead = useMutation({
    mutationFn: () => apiPatch(`/notifications/${notification.id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={[
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-md',
            isUnread ? 'bg-primary text-text' : 'bg-surface-sunk text-text-muted',
          ].join(' ')}
        >
          <BellIcon />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
              {formatStatus(notification.notificationType)}
            </span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-border" />
            <span className="font-mono text-xs text-text-muted">
              {shortCode('log', notification.id)}
            </span>
          </p>
          {payloadLines(notification.payload).map((line) => (
            <p key={line} className="text-sm text-text-muted">
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-right text-sm text-text-muted" title={when?.absolute}>
          {when?.relative.replace('Reported ', '') ?? '--'}
        </span>
        {isUnread && (
          <Button variant="secondary" loading={markRead.isPending} onClick={() => markRead.mutate()}>
            Mark read
          </Button>
        )}
      </div>
    </div>
  );
}

// One feed, three mount points: the admin console, the customer account and
// the field console all read the same tenant-scoped GET /notifications.
// The Figma frames (168:3011, 276:7669, 359:2970) differ only in their
// surrounding shell, which the layout routes already supply.
export function NotificationFeed() {
  const [limit, setLimit] = useState(20);
  const query = useQuery(notificationQueries.list(limit, 0));

  if (query.isPending) return <p className="text-sm text-text-muted">Loading notifications...</p>;

  if (query.isError)
    return (
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 border-error p-4">
        <p className="text-sm text-error">
          Notifications could not be loaded just now. Check your connection and try again.
        </p>
        <Button variant="secondary" onClick={() => query.refetch()}>
          Retry
        </Button>
      </Surface>
    );

  if (query.data.total === 0)
    return (
      <EmptyState
        title="Nothing needs you right now"
        description="Maintenance alerts, weather advisories and review-queue items land here as they happen."
      />
    );

  return (
    <Surface radius="md" elevation="sm" className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-display text-base font-semibold text-text">Pending items</h2>
        <p className="text-sm text-text-muted">
          Showing {query.data.items.length} of {query.data.total}
        </p>
      </div>
      <div>
        {query.data.items.map((item) => (
          <NotificationRow key={item.id} notification={item} />
        ))}
      </div>
      {query.data.items.length < query.data.total && (
        <div className="flex justify-center border-t border-border bg-surface-sunk px-4 py-3">
          <Button variant="ghost" onClick={() => setLimit((current) => current + 20)}>
            Load more notifications
          </Button>
        </div>
      )}
    </Surface>
  );
}
