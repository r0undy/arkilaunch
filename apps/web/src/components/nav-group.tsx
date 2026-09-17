import { Link } from '@tanstack/react-router';
import type { NavGroup } from '../lib/nav-config.js';

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
 */
export function activeNavTarget(targets: string[], pathname: string): string | null {
  let best: string | null = null;
  for (const to of targets) {
    const isMatch = pathname === to || pathname.startsWith(to.endsWith('/') ? to : `${to}/`);
    if (isMatch && (best === null || to.length > best.length)) best = to;
  }
  return best;
}

export function NavGroupList({ groups, pathname, onNavigate }: NavGroupListProps) {
  const active = activeNavTarget(
    groups.flatMap((group) => group.items.map((item) => item.to)),
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
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
