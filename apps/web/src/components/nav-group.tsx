import { Link } from '@tanstack/react-router';
import type { NavGroup } from '../lib/nav-config.js';
import { useCart } from '../lib/cart-client.js';

export interface NavGroupListProps {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}

// A dispatch-board lamp, not an amber fill: active state is a 3px amber
// indicator bar on the surface color, keeping amber's meaning ("primary
// action") intact while still marking "this one" (DESIGN.md §2.1).
/**
 * The one destination the current URL belongs to.
 *
 * A plain `startsWith` marked every ancestor active too: on `/app/ocr` the
 * section root `/app` matched as well, so Dashboard and Field logs both lit
 * up and the indicator stopped meaning "you are here". Taking the longest
 * match instead means the most specific destination wins, and exactly one
 * item is ever active.
 *
 * Two refinements on top of that, because the longest match is only the right
 * answer when some destination genuinely owns the URL:
 *
 * - `exact` is for a section root (`/account`, `/app`). It is a prefix of
 *   every page in its section, so it won every match that had no more
 *   specific entry -- the cart, the checkout, the invoice and the company
 *   form all showed "Home" as the active destination.
 * - `owns` lets a destination claim screens reached from it that have no
 *   sidebar entry of their own, so "My bookings" stays lit on a checkout
 *   rather than the blade vanishing.
 */
export interface NavTarget {
  to: string;
  exact?: boolean;
  owns?: string[];
}

function ownsPath(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

export function activeNavTarget(targets: (string | NavTarget)[], pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const target of targets) {
    const item: NavTarget = typeof target === 'string' ? { to: target } : target;
    const prefixes = item.exact ? [] : [item.to, ...(item.owns ?? [])];
    const matched = pathname === item.to ? item.to : prefixes.find((p) => ownsPath(p, pathname));
    // Ranked by how much of the URL the matching prefix accounts for, so a
    // longer `owns` entry still beats a shorter `to`.
    if (matched !== undefined && matched.length > bestLength) {
      best = item.to;
      bestLength = matched.length;
    }
  }
  return best;
}

export function NavGroupList({ groups, pathname, onNavigate }: NavGroupListProps) {
  // ponytail: one hardcoded path, because ACCOUNT_NAV is a static module
  // constant and cannot carry a live count. Generalise into NavItem only if a
  // second destination ever needs a badge.
  const cartCount = useCart().length;
  const active = activeNavTarget(
    groups.flatMap((group) => group.items),
    pathname,
  );

  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const isActive = item.to === active;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  // Link marks itself active on a prefix match and sets
                  // aria-current from that, which is the same ancestor
                  // problem in a second place -- so its own matching is
                  // pinned to exact and the attribute comes from the
                  // longest-match above, which is the one source of truth.
                  activeOptions={{ exact: true }}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'flex min-h-11 items-center gap-2.5 rounded-sm border-l-[3px] px-3 py-2 text-sm font-medium',
                    isActive
                      ? 'border-primary bg-surface font-semibold text-text'
                      : 'border-transparent text-text-muted hover:bg-surface hover:text-text',
                  ].join(' ')}
                >
                  {item.icon && <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
                  {item.label}
                  {item.to === '/account/cart' && cartCount > 0 && (
                    <span
                      // The count is in the accessible name, not only the
                      // pill: "Cart 3" read aloud beats a bare "3".
                      aria-label={`${cartCount} in cart`}
                      className="ml-auto min-w-5 rounded-pill bg-primary px-1.5 py-0.5 text-center text-xs font-semibold text-text"
                    >
                      {cartCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
