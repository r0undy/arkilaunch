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
export function NavGroupList({ groups, pathname, onNavigate }: NavGroupListProps) {
  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={[
                    'min-h-11 rounded-sm border-l-[3px] px-3 py-2 text-sm font-medium',
                    active
                      ? 'border-primary bg-surface font-semibold text-text'
                      : 'border-transparent text-text-muted hover:bg-surface hover:text-text',
                  ].join(' ')}
                >
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
