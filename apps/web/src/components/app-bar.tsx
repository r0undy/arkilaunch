import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { describeNotification, feedAreaOf, NotificationIcon, notificationQueries } from './notification-feed.js';
import { apiPatch } from '../lib/api-client.js';
import { formatStatus } from '../lib/format.js';
import { ShoppingCart } from 'lucide-react';
import { clearTokens } from '../lib/auth-client.js';
import { useCart } from '../lib/cart-client.js';
import { getCurrentRole, homeHref } from '../lib/guards.js';
import { edtrQueries, notificationsQueries } from '../lib/queries.js';
import { StatusPill } from './status-pill.js';
import { applicationsListQuery } from './application-actions.js';
import { AlertIcon, BellIcon, LogOutIcon } from './icons.js';
import { useHeaderColor, useTenant } from '../lib/tenant.js';

// Controls inherit the bar's text (steel bar: paper; a tenant color: its black
// or white) and hover as a tile of that same color (DSD §4.1 Nav shell).
const TILE = 'hover:bg-current/10';

export interface AppBarProps {
  tenantLabel: string;
  onMenuClick?: () => void;
}

// DESIGN.md §4.1 Nav shell (role-aware): tenant mark leads, review-queue
// count and unread notifications surface here, account menu stays in the same
// app-bar position on every authed screen (SC 3.2.6). A failed badge fetch
// renders no badge rather than a stale or wrong number.
//
// The bar stays ONE row at every width. It used to wrap instead: that was
// the cheapest way to stop a 360px overflow, but live QA showed what it
// actually produced on a phone -- "Review queue" broken across two lines
// inside its own pill, "Sign out" split in half, and the whole header
// eating ~100px of an 800px screen before any content. Below `sm` the
// counts render as icon + number and only the label is dropped, so the
// tenant name (which truncates) absorbs the squeeze instead of the
// controls. DESIGN.md §6: 44x44px touch targets, never color-only -- every
// icon-only control keeps a real accessible name.
// Always present, right of the cart. A disclosure button, not <details>:
// <details> carries an implicit `group` role, and the card lists (and their
// specs) find cards by that role. Closes on an outside click or Escape. The
// panel is the feed's own first page of five, fetched on open.
function NotificationBell({
  unreadCount,
  seeMorePath,
  tone,
}: {
  unreadCount: number | null;
  seeMorePath: string;
  tone: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const latest = useQuery({ ...notificationQueries.list(5, 0), enabled: open, retry: false });

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
  // Opening a notification from the bell marks it read, like the feed does.
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
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm ${tone}`}
      >
        <BellIcon aria-hidden="true" className="h-5 w-5" />
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
          className="fixed inset-x-3 top-14 z-50 overflow-hidden rounded-md border border-border bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
        >
          {latest.isPending && <p className="px-4 py-3 text-sm text-text-muted">Loading…</p>}
          {latest.isError && (
            <p className="px-4 py-3 text-sm text-error">Notifications could not be loaded.</p>
          )}
          {latest.data?.items.length === 0 && (
            <p className="px-4 py-3 text-sm text-text-muted">Nothing needs you right now.</p>
          )}
          <ul>
            {latest.data?.items.map((n) => {
              const described = describeNotification(n.notificationType, n.payload, area);
              const body = (
                <div className="flex items-start gap-3">
                  <NotificationIcon type={n.notificationType} unread={n.status === 'unread'} className="h-8 w-8" />
                  <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-text">
                    {n.status === 'unread' && (
                      <span
                        aria-label="Unread"
                        className="h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                    {described?.title ?? formatStatus(n.notificationType)}
                  </p>
                  {described && (
                    <p className="line-clamp-2 text-xs text-text-muted">{described.body}</p>
                  )}
                  </div>
                </div>
              );
              return (
                <li key={n.id} className="border-b border-border last:border-b-0">
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
            className="block border-t border-border px-4 py-3 text-center text-sm font-medium text-text hover:bg-surface-sunk"
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
  // The same bar renders inside the account shell, where /app/* is a role
  // bounce rather than a destination.
  const isCustomer = role === 'customer';
  // Each console has its own feed; the platform host serves no /app route.
  const notificationsPath = isCustomer
    ? '/account/notifications'
    : role === 'platform_admin'
      ? '/admin/notifications'
      : '/app/notifications';

  const notifications = useQuery({ ...notificationsQueries.unreadCount(), retry: false });
  // GET /edtr is staff-only, so this fired a guaranteed 403 on every page a
  // customer loaded -- a console error and a wasted round trip each time,
  // for a badge they can never see. The bar has rendered in the account
  // shell since it was written; moving the catalog into that shell just made
  // it happen on more pages.
  // The platform admin runs no tenant's field logs; its queue is the company
  // applications waiting on a decision, so the pill counts those instead.
  const isPlatformAdmin = role === 'platform_admin';
  const edtrList = useQuery({
    ...edtrQueries.reviewCount(),
    retry: false,
    // The queue is staff-only (edtr:read); a timekeeper submits and does not read it.
    enabled: !isCustomer && !isPlatformAdmin && role !== 'timekeeper',
  });
  const applications = useQuery({
    ...applicationsListQuery(1, 0),
    retry: false,
    enabled: isPlatformAdmin,
  });
  // The cart sits in the bar beside Sign out (Figma 185:1599 puts it in the
  // top bar, not the sidebar). Customer-only: staff have no cart, and the bar
  // is shared with the admin shell.
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
  const tone = TILE;

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
            className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm lg:hidden ${tone}`}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-5 w-5"
            >
              <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <Link
          to={homeHref()}
          className="flex min-w-0 items-center gap-2 text-base font-medium"
          aria-label={`${tenantLabel} home`}
        >
          {/* The mark leads the bar (BRAND.md): the tenant's icon, else its
              logo, else its initial on its own primary. */}
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
          <>
            {/* Same fact, two densities: the full pill once there is room
                for its label, and an icon + count that still reads as a
                warning below it. */}
            {/* Amber as a FILL with dark text, not amber text on white.
                --recon-review is PAGASA yellow (#c9a100), which measures
                2.45:1 against the white bar -- under both the 4.5:1 DESIGN.md
                §6 demands of text and the 3:1 a non-text indicator needs. The
                pill's own tone pairing already solves this, so the compact
                form borrows it and keeps icon + number + name so it is never
                colour-only. */}
            {/* QA 27: the pill opens the queue it counts. */}
            <Link
              {...reviewQueueLink}
              aria-label={`${reviewQueueLabel}: ${reviewQueueCount}. Open it`}
              className="flex min-h-11 items-center sm:hidden"
            >
              <span className="flex items-center gap-1 rounded-sm bg-recon-review px-1.5 py-1 text-text">
                <AlertIcon aria-hidden="true" className="h-4 w-4" />
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {reviewQueueCount}
                </span>
              </span>
            </Link>
            {/* Hidden via a WRAPPER, not a `hidden` class on the pill
                itself. StatusPill sets `inline-flex` in its own base
                classes, and between two single-class display utilities the
                winner is CSS source order, not the order they appear in the
                class attribute -- so `hidden` lost and the phone rendered
                the icon AND the 153px pill side by side, which is what put
                this group over the viewport in the first place. */}
            <Link {...reviewQueueLink} className="hidden rounded-full hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring sm:block">
              <StatusPill
                tone="recon-review"
                label={reviewQueueLabel}
                icon={<AlertIcon />}
                value={String(reviewQueueCount)}
                className="whitespace-nowrap"
              />
            </Link>
          </>
        )}

        {isCustomer && (
          <Link
            to="/account/cart"
            // The count belongs in the accessible name, not only the pill:
            // "Cart, 3 items" read aloud beats a bare "3", and the empty cart
            // still needs a name to be reachable at all.
            aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart, empty'}
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm px-2 text-sm font-medium sm:gap-2 sm:px-3 ${tone}`}
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

        <NotificationBell unreadCount={unreadCount} seeMorePath={notificationsPath} tone={tone} />

        {/* Icon-only on a phone. Under real mobile emulation the layout
            viewport is 320px, not the 360px a desktop-sized window reports,
            and the word "Sign out" was the single widest thing keeping this
            group at 361px -- over the viewport, on every authed screen. */}
        <button
          type="button"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
          aria-label="Sign out"
          className={`flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-2 text-sm font-medium sm:px-3 ${tone}`}
        >
          <LogOutIcon aria-hidden="true" className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
