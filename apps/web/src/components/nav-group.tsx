import { Link } from '@tanstack/react-router';
import type { NavGroup } from '../lib/nav-config.js';

export interface NavGroupListProps {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}

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
    // Longest match wins so exactly one item is active; a longer `owns` beats a shorter `to`.
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
        <p className="mb-1 px-3 text-sm font-bold text-text">
          {group.title}
        </p>
      )}
      <div className="flex flex-col">
        {group.items.map((item) => {
          const isActive = item.to === active;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              // Link's own prefix match would set aria-current on ancestors too; activeNavTarget decides.
              activeOptions={{ exact: true }}
              aria-current={isActive ? 'page' : undefined}
              className={[
                // Cloudscape side nav: the active page is bold link-colour text, no fill or bar.
                'flex min-h-10 items-center rounded-sm text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                isActive ? 'font-bold text-accent' : 'text-text hover:text-accent',
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

  // One nav landmark: pinned groups sit inside it.
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
