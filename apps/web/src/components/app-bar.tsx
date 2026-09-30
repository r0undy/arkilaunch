import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { describeNotification, feedAreaOf, notificationEdge, NotificationKindLabel } from './notification-feed.js';
import { apiPatch } from '../lib/api-client.js';
import { formatStatus } from '../lib/format.js';
import { Bell, LogOut, Menu, ShoppingCart, TriangleAlert } from 'lucide-react';
import { clearTokens } from '../lib/auth-client.js';
import { useCart } from '../lib/cart-client.js';
import { getCurrentRole, homeHref } from '../lib/guards.js';
import { edtrQueries, notificationsQueries, tenantsQueries } from '../lib/queries.js';
import { useHeaderColor, useTenant } from '../lib/tenant.js';

const TILE = 'hover:bg-current/10';

export interface AppBarProps {
  tenantLabel: string;
  onMenuClick?: () => void;
}

// A disclosure button, not <details>: <details> has an implicit `group` role, which card lists find cards by.
function NotificationBell({
  unreadCount,
  seeMorePath,
}: {
  unreadCount: number | null;
  seeMorePath: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const latest = useQuery({ ...notificationsQueries.list(5, 0), enabled: open, retry: false });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const closePanel = () => setOpen(false);
  const area = feedAreaOf(useRouterState({ select: (s) => s.location.pathname }));
  const markRead = (id: string) => {
    void apiPatch(`/notifications/${id}/read`, {}).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm ${TILE}`}
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        {unreadCount !== null && unreadCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-on-primary">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Latest notifications"
          className="fixed inset-x-3 top-14 z-50 flex max-h-[min(32rem,calc(100dvh-5rem))] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
        >
          {latest.isPending && <p className="px-4 py-3 text-sm text-text-muted">Loading…</p>}
          {latest.isError && (
            <p className="px-4 py-3 text-sm text-error">Notifications could not be loaded.</p>
          )}
          {latest.data?.items.length === 0 && (
            <p className="px-4 py-3 text-sm text-text-muted">Nothing needs you right now.</p>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {latest.data?.items.map((n) => {
              const described = describeNotification(n.notificationType, n.payload, area);
              const body = (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <NotificationKindLabel type={n.notificationType} />
                  <p className={`text-sm text-text ${n.status === 'unread' ? 'font-semibold' : ''}`}>
                    {n.status === 'unread' && <span className="sr-only">Unread: </span>}
                    {described?.title ?? formatStatus(n.notificationType)}
                  </p>
                  {described && (
                    <p className="line-clamp-2 text-xs text-text-muted">{described.body}</p>
                  )}
                </div>
              );
              return (
                <li key={n.id} className={`border-b border-border last:border-b-0 ${notificationEdge(n.notificationType, n.status === 'unread')}`}>
                  {described?.action ? (
                    <Link
                      to={described.action.to}
                      params={described.action.params}
                      {...(described.action.search ? { search: described.action.search } : {})}
                      onClick={() => {
                        if (n.status === 'unread') markRead(n.id);
                        closePanel();
                      }}
                      className="block px-4 py-3 hover:bg-surface-sunk"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <Link
            to={seeMorePath}
            onClick={closePanel}
            className="block shrink-0 border-t border-border bg-surface px-4 py-3 text-center text-sm font-medium text-accent hover:bg-surface-sunk"
          >
            See more
          </Link>
        </div>
      )}
    </div>
  );
}

export function AppBar({ tenantLabel, onMenuClick }: AppBarProps) {
  const role = getCurrentRole();
  const isCustomer = role === 'customer';
  const notificationsPath = isCustomer
    ? '/account/notifications'
    : role === 'platform_admin'
      ? '/admin/notifications'
      : '/app/notifications';

  const notifications = useQuery({ ...notificationsQueries.unreadCount(), retry: false });
  const isPlatformAdmin = role === 'platform_admin';
  const edtrList = useQuery({
    ...edtrQueries.reviewCount(),
    retry: false,
    // Staff-only endpoint (edtr:read): anyone else gets a guaranteed 403.
    enabled: !isCustomer && !isPlatformAdmin && role !== 'timekeeper',
  });
  const applications = useQuery({
    ...tenantsQueries.applications(1, 0),
    retry: false,
    enabled: isPlatformAdmin,
  });
  const cartCount = useCart().length;

  const unreadCount = notifications.data?.total ?? null;
  const reviewQueueCount = isPlatformAdmin ? (applications.data?.total ?? null) : (edtrList.data?.total ?? null);
  const reviewQueueLabel = isPlatformAdmin ? 'Applications' : 'Review queue';
  const reviewQueueLink = isPlatformAdmin
    ? ({ to: '/admin/applications' } as const)
    : ({ to: '/app/ocr', search: { status: 'review' } } as const);

  const bar = useHeaderColor();
  const tenant = useTenant();
  const mark = tenant?.iconUrl ?? tenant?.logoUrl;

  return (
    <header
      style={bar ?? undefined}
      className={`sticky top-0 z-40 flex min-h-14 items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-4 ${bar ? '' : 'bg-nav text-text-inverse'}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Toggle navigation"
            className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm lg:hidden ${TILE}`}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <Link
          to={homeHref()}
          className="flex min-w-0 items-center gap-2 text-base font-medium"
          aria-label={`${tenantLabel} home`}
        >
          {mark ? (
            <img src={mark} alt="" className="h-8 w-auto max-w-[120px] shrink-0 object-contain" />
          ) : (
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary"
            >
              {tenantLabel.trim().charAt(0).toUpperCase() || 'A'}
            </span>
          )}
          <span className="truncate">{tenantLabel}</span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
        {reviewQueueCount !== null && reviewQueueCount > 0 && (
          <Link
            {...reviewQueueLink}
            aria-label={`${reviewQueueLabel}: ${reviewQueueCount}. Open it`}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${TILE}`}
          >
            <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{reviewQueueLabel}</span>
            <span className="font-mono tabular-nums">{reviewQueueCount}</span>
          </Link>
        )}

        {isCustomer && (
          <Link
            to="/account/cart"
            aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart, empty'}
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm px-2 text-sm font-medium sm:gap-2 sm:px-3 ${TILE}`}
          >
            <ShoppingCart aria-hidden="true" className="h-5 w-5" />
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-on-primary">
                {cartCount}
              </span>
            )}
          </Link>
        )}

        <NotificationBell unreadCount={unreadCount} seeMorePath={notificationsPath} />

        <button
          type="button"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
          aria-label="Sign out"
          className={`flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-2 text-sm font-medium sm:px-3 ${TILE}`}
        >
          <LogOut aria-hidden="true" className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
