import { useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import type { NavGroup } from '../lib/nav-config.js';
import { AppBar } from './app-bar.js';
import { Modal } from './modal.js';
import { NavGroupList } from './nav-group.js';
import { SkipLink } from './skip-link.js';
import { FlashbarSlot } from './toast.js';

export interface SidebarShellProps {
  navGroups: NavGroup[];
  navTitle: string;
  tenantLabel: string;
  children: ReactNode;
}

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

export function SidebarShell({ navGroups, navTitle, tenantLabel, children }: SidebarShellProps) {
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

  // Cloudscape app layout: a bare glyph (hamburger opens, X closes) that darkens on hover, no tile behind it.
  const railButton =
    'flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

  return (
    <ShellNavContext.Provider value={{ navGroups, tenantLabel }}>
      <div className="flex min-h-screen flex-col bg-bg">
        <SkipLink />
        <AppBar tenantLabel={tenantLabel} onMenuClick={() => setDrawerOpen((v) => !v)} />
        <div className="flex flex-1">
          {/* Named: the catalog renders a second complementary landmark. */}
          {collapsed ? (
            <aside aria-label="Sidebar" className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-14 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-surface px-1.5 pb-4 pt-3 [scrollbar-width:thin] lg:flex">
              <button type="button" onClick={toggleCollapsed} aria-expanded={false} aria-label="Open navigation" title="Open navigation" className={`${railButton} mb-3`}>
                <Menu aria-hidden strokeWidth={2.25} className="h-5 w-5" />
              </button>
              <NavGroupList groups={navGroups} pathname={pathname} collapsed />
            </aside>
          ) : (
            <aside
              aria-label="Sidebar"
              className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] border-r border-border bg-surface px-3 pb-6 pt-3 lg:flex"
            >
              <div className="mb-3 flex min-h-11 items-center justify-between gap-2 px-3">
                <h2 className="min-w-0 truncate text-base font-semibold text-text">{navTitle}</h2>
                <button type="button" onClick={toggleCollapsed} aria-expanded aria-label="Close navigation" title="Close navigation" className={`${railButton} -mr-3`}>
                  <X aria-hidden strokeWidth={2.25} className="h-5 w-5" />
                </button>
              </div>
              <NavGroupList groups={navGroups} pathname={pathname} />
            </aside>
          )}

          <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title={navTitle} placement="right" size="sm">
            <NavGroupList groups={navGroups} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </Modal>

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
