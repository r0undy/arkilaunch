import { useRouterState } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import type { NavGroup } from '../lib/nav-config.js';
import { AppBar } from './app-bar.js';
import { Modal } from './modal.js';
import { NavGroupList } from './nav-group.js';
import { SkipLink } from './skip-link.js';

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
      <SkipLink />
      <AppBar tenantLabel={tenantLabel} onMenuClick={() => setDrawerOpen((v) => !v)} />
      <div className="flex flex-1">
        {/* Named, because the catalog page renders a second complementary
            landmark (its right rail) and an unnamed pair is ambiguous to a
            screen reader. */}
        <aside
          aria-label="Sidebar"
          className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-border bg-surface-sunk px-3 py-6 lg:block"
        >
          <NavGroupList groups={navGroups} pathname={pathname} />
        </aside>

        {/* The shared dialog, so the phone drawer gets the focus trap,
            Escape and focus return it was missing. */}
        <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu" placement="right" size="sm">
          <NavGroupList groups={navGroups} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
        </Modal>

        {/* Capped at the wide breakpoint: past 1440px a table stretched to
            the edges is harder to scan, not easier. */}
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
