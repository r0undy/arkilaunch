import { useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { NavGroup } from '../lib/nav-config.js';
import { AppBar } from './app-bar.js';
import { Modal } from './modal.js';
import { NavGroupList } from './nav-group.js';
import { SkipLink } from './skip-link.js';
import { FlashbarSlot } from './toast.js';

export interface SidebarShellProps {
  navGroups: NavGroup[];
  tenantLabel: string;
  children: ReactNode;
}

// What PageHeader needs to draw its breadcrumbs. Null outside a shell, where
// there is no nav to derive a trail from.
export const ShellNavContext = createContext<{ navGroups: NavGroup[]; tenantLabel: string } | null>(null);
export const useShellNav = () => useContext(ShellNavContext);

const NAV_KEY = 'arkilaunch.sideNav';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

// DESIGN.md §4.1 Nav shell (role-aware): tenant mark leads in the app bar,
// a side nav on desktop that collapses to a rail (AWS Console), an
// off-canvas drawer at the 360px baseline.
export function SidebarShell({ navGroups, tenantLabel, children }: SidebarShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleCollapsed() {
    setCollapsed((was) => {
      try {
        localStorage.setItem(NAV_KEY, was ? 'open' : 'collapsed');
      } catch {
        // Private mode: the choice lasts this page load only.
      }
      return !was;
    });
  }

  const railButton =
    'flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunk hover:text-text';

  return (
    <ShellNavContext.Provider value={{ navGroups, tenantLabel }}>
      <div className="flex min-h-screen flex-col bg-bg">
        <SkipLink />
        <AppBar tenantLabel={tenantLabel} onMenuClick={() => setDrawerOpen((v) => !v)} />
        <div className="flex flex-1">
          {/* Named, because the catalog page renders a second complementary
              landmark (its right rail) and an unnamed pair is ambiguous to a
              screen reader. */}
          {collapsed ? (
            <div className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-14 shrink-0 flex-col items-center border-r border-border bg-surface py-3 lg:flex">
              <button type="button" onClick={toggleCollapsed} aria-expanded={false} aria-label="Open navigation" className={railButton}>
                <PanelLeftOpen aria-hidden className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <aside
              aria-label="Sidebar"
              className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] border-r border-border bg-surface px-3 pb-6 pt-3 lg:flex"
            >
              <div className="mb-2 flex items-center justify-between pl-3">
                <span className="line-clamp-2 text-base font-medium text-text">{tenantLabel}</span>
                <button type="button" onClick={toggleCollapsed} aria-expanded aria-label="Close navigation" className={railButton}>
                  <PanelLeftClose aria-hidden className="h-5 w-5" />
                </button>
              </div>
              <NavGroupList groups={navGroups} pathname={pathname} />
            </aside>
          )}

          {/* The shared dialog, so the phone drawer gets the focus trap,
              Escape and focus return it was missing. */}
          <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu" placement="right" size="sm">
            <NavGroupList groups={navGroups} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </Modal>

          {/* Capped at the wide breakpoint: past 1440px a table stretched to
              the edges is harder to scan, not easier. */}
          <main id="main" className="min-w-0 flex-1 px-4 pb-10 pt-4 sm:px-8 sm:pt-6">
            <div className="mx-auto w-full max-w-[1440px]">
              <FlashbarSlot />
              {children}
            </div>
          </main>
        </div>
      </div>
    </ShellNavContext.Provider>
  );
}
