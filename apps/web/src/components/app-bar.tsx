import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { clearTokens } from '../lib/auth-client.js';
import { useCart } from '../lib/cart-client.js';
import { getCurrentRole } from '../lib/guards.js';
import { edtrQueries, notificationsQueries } from '../lib/queries.js';
import { StatusPill } from './status-pill.js';
import { AlertIcon, BellIcon, LogOutIcon } from './icons.js';

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
export function AppBar({ tenantLabel, onMenuClick }: AppBarProps) {
  const role = getCurrentRole();
  // The same bar renders inside the account shell, where /app/* is a role
  // bounce rather than a destination.
  const isCustomer = role === 'customer';
  const notificationsPath = isCustomer ? '/account/notifications' : '/app/notifications';

  const notifications = useQuery({ ...notificationsQueries.list(), retry: false });
  // GET /edtr is staff-only, so this fired a guaranteed 403 on every page a
  // customer loaded -- a console error and a wasted round trip each time,
  // for a badge they can never see. The bar has rendered in the account
  // shell since it was written; moving the catalog into that shell just made
  // it happen on more pages.
  const edtrList = useQuery({ ...edtrQueries.list(), retry: false, enabled: !isCustomer });
  // The cart sits in the bar beside Sign out (Figma 185:1599 puts it in the
  // top bar, not the sidebar). Customer-only: staff have no cart, and the bar
  // is shared with the admin shell.
  const cartCount = useCart().length;

  const unreadItems = notifications.data?.items;
  const unreadCount = unreadItems ? unreadItems.filter((n) => n.status === 'unread').length : null;
  const reviewItems = edtrList.data?.items as { status?: string }[] | undefined;
  const reviewQueueCount = reviewItems
    ? reviewItems.filter((e) => e.status === 'review').length
    : null;

  return (
    <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 sm:gap-4 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Toggle navigation"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm text-text lg:hidden"
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
        <span className="truncate font-display text-base font-semibold text-text">
          {tenantLabel}
        </span>
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
            <span
              aria-label={`Review queue: ${reviewQueueCount}`}
              className="flex min-h-11 items-center sm:hidden"
            >
              <span className="flex items-center gap-1 rounded-sm bg-recon-review px-1.5 py-1 text-text">
                <AlertIcon aria-hidden="true" className="h-4 w-4" />
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {reviewQueueCount}
                </span>
              </span>
            </span>
            {/* Hidden via a WRAPPER, not a `hidden` class on the pill
                itself. StatusPill sets `inline-flex` in its own base
                classes, and between two single-class display utilities the
                winner is CSS source order, not the order they appear in the
                class attribute -- so `hidden` lost and the phone rendered
                the icon AND the 153px pill side by side, which is what put
                this group over the viewport in the first place. */}
            <span className="hidden sm:block">
              <StatusPill
                tone="recon-review"
                label="Review queue"
                icon={<AlertIcon />}
                value={String(reviewQueueCount)}
                className="whitespace-nowrap"
              />
            </span>
          </>
        )}

        {/* A bare orange number sat here with no icon, which read as a
            decoration rather than "you have unread notifications". */}
        {unreadCount !== null && unreadCount > 0 && (
          <Link
            to={notificationsPath}
            aria-label={`${unreadCount} unread notifications`}
            className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm text-text"
          >
            <BellIcon aria-hidden="true" className="h-5 w-5" />
            <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-text">
              {unreadCount}
            </span>
          </Link>
        )}

        {isCustomer && (
          <Link
            to="/account/cart"
            // The count belongs in the accessible name, not only the pill:
            // "Cart, 3 items" read aloud beats a bare "3", and the empty cart
            // still needs a name to be reachable at all.
            aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart, empty'}
            className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm px-2 text-sm font-medium text-text-muted hover:text-text sm:gap-2 sm:px-3"
          >
            <ShoppingCart aria-hidden="true" className="h-5 w-5" />
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-text">
                {cartCount}
              </span>
            )}
          </Link>
        )}

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
          className="flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-2 text-sm font-medium text-text-muted hover:text-text sm:px-3"
        >
          <LogOutIcon aria-hidden="true" className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
