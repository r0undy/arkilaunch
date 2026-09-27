import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { homeHref } from '../lib/guards.js';
import { activeNavTarget } from './nav-group.js';
import { useShellNav } from './sidebar-shell.js';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

// AWS Console breadcrumbs: tenant, then the nav destination this page belongs
// to when it is a page under it, then this page. Derived from the shell's nav,
// so no page keeps its own trail. Outside a shell there is none.
function Breadcrumbs({ title }: { title: string }) {
  const shell = useShellNav();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!shell) return null;
  const items = shell.navGroups.flatMap((g) => g.items);
  const activeTo = activeNavTarget(items, pathname);
  const active = items.find((i) => i.to === activeTo);
  const trail: { label: string; to?: string }[] = [{ label: shell.tenantLabel, to: homeHref() }];
  if (active && (active.to !== pathname || active.label !== title)) trail.push({ label: active.label, to: active.to });
  trail.push({ label: title });

  return (
    <nav aria-label="Breadcrumbs" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {trail.map((crumb, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="h-4 w-4 text-text-muted" />}
            {crumb.to ? (
              <Link to={crumb.to} className="text-accent hover:underline">
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-text-muted">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// One header rhythm shared by every console screen: breadcrumbs, a 500-weight
// sentence-case title (DESIGN.md §2.3) and an action slot.
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div>
      <Breadcrumbs title={title} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display-md text-text lg:text-display-lg">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-base text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
