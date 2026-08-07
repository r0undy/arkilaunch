import { useRouterState } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import type { NavGroup } from '../lib/nav-config.js';
import { AppBar } from './app-bar.js';
import { NavGroupList } from './nav-group.js';

export interface SidebarShellProps {
  navGroups: NavGroup[];
  tenantLabel: string;
  children: ReactNode;
}

// DESIGN.md §4.1 Nav shell (role-aware): tenant mark leads in the app bar,
// persistent sidebar on desktop, an off-canvas drawer at the 360px baseline
// so the console never breaks the mandated mobile floor.
export function SidebarShell({ navGroups, tenantLabel, children }: SidebarShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <AppBar tenantLabel={tenantLabel} onMenuClick={() => setDrawerOpen((v) => !v)} />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-surface-sunk px-3 py-6 lg:block">
          <NavGroupList groups={navGroups} pathname={pathname} />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="flex-1 bg-[var(--yb-modal-scrim)]"
            />
            <div className="w-64 max-w-[80vw] bg-surface-sunk px-3 py-6 shadow-lg">
              <NavGroupList groups={navGroups} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
