import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { clearTokens } from '../lib/auth-client.js';
import { edtrQueries, notificationsQueries } from '../lib/queries.js';
import { StatusPill } from './status-pill.js';
import { AlertIcon, CloudIcon } from './icons.js';

export interface AppBarProps {
  tenantLabel: string;
  onMenuClick?: () => void;
}

// DESIGN.md §4.1 Nav shell (role-aware): tenant mark leads, review-queue
// count and weather advisories surface here, account menu stays in the same
// app-bar position on every authed screen (SC 3.2.6). A failed badge fetch
// renders no badge rather than a stale or wrong number.
export function AppBar({ tenantLabel, onMenuClick }: AppBarProps) {
  const notifications = useQuery({ ...notificationsQueries.list(), retry: false });
  const edtrList = useQuery({ ...edtrQueries.list(), retry: false });

  const unreadItems = notifications.data?.items;
  const unreadCount = unreadItems ? unreadItems.filter((n) => n.status === 'unread').length : null;
  const reviewItems = edtrList.data?.items as { status?: string }[] | undefined;
  const reviewQueueCount = reviewItems ? reviewItems.filter((e) => e.status === 'review').length : null;

  return (
    <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Toggle navigation"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text lg:hidden"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
              <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <span className="font-display text-base font-semibold text-text">{tenantLabel}</span>
      </div>

      <div className="flex items-center gap-3">
        {reviewQueueCount !== null && reviewQueueCount > 0 && (
          <StatusPill tone="recon-review" label="Review queue" icon={<AlertIcon />} value={String(reviewQueueCount)} />
        )}
        <Link to="/app/deployment" aria-label="Weather advisories" className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text-muted hover:text-text">
          <CloudIcon className="h-5 w-5" />
        </Link>
        {unreadCount !== null && unreadCount > 0 && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-text" aria-label={`${unreadCount} unread notifications`}>
            {unreadCount}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
          className="min-h-11 rounded-sm px-3 text-sm font-medium text-text-muted hover:text-text"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
