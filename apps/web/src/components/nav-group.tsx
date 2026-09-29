import { Link } from '@tanstack/react-router';
import type { NavGroup } from '../lib/nav-config.js';

export interface NavGroupListProps {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}

// AWS side nav: the active item reads in the link color on a quiet tile, so
// amber keeps its one meaning, "primary action" (DESIGN.md §2.1).
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

export function NavGroupList({ groups, pathname, onNavigate, collapsed = false }: NavGroupListProps) {
  const active = activeNavTarget(
    groups.flatMap((group) => group.items),
    pathname,
  );
  const listed = groups.filter((group) => !group.pinned);
  const pinned = groups.filter((group) => group.pinned);

  const renderGroup = (group: NavGroup, labelled: boolean) => (
    <div key={group.title} className={collapsed ? 'border-t border-border pt-2 first:border-0 first:pt-0' : ''}>
      {labelled && !collapsed && !group.hideTitle && (
        <p className="mb-1 px-3 text-xs font-semibold text-text-muted">
          {group.title}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {group.items.map((item) => {
          const isActive = item.to === active;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              // Link marks itself active on a prefix match and sets
              // aria-current from that, which is the same ancestor
              // problem in a second place -- so its own matching is
              // pinned to exact and the attribute comes from the
              // longest-match above, which is the one source of truth.
              activeOptions={{ exact: true }}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex min-h-11 items-center rounded-sm border-l-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                isActive
                  ? 'border-accent bg-surface-sunk font-semibold text-accent'
                  : 'border-transparent text-text-muted hover:bg-surface-sunk hover:text-text',
              ].join(' ')}
            >
              {item.icon && <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />}
              {!collapsed && <span className="min-w-0">{item.label}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );

  // One nav, so the landmark count stays one; the pinned groups sit at its
  // foot (mt-auto) when the column has room to spare.
  return (
    <nav aria-label="Primary navigation" className={`flex flex-1 flex-col ${collapsed ? 'gap-2' : 'gap-5'}`}>
      {listed.map((group) => renderGroup(group, true))}
      {pinned.length > 0 && (
        <div className={`mt-auto flex flex-col border-t border-border ${collapsed ? 'gap-2 pt-2' : 'gap-5 pt-4'}`}>
          {pinned.map((group) => renderGroup(group, false))}
        </div>
      )}
    </nav>
  );
}
