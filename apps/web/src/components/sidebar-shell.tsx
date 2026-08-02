import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { NavItem } from '../lib/nav-config.js';
import { clearTokens } from '../lib/auth-client.js';
import { Button } from './button.js';

export interface SidebarShellProps {
  navItems: NavItem[];
  tenantLabel: string;
  children: ReactNode;
}

// DESIGN.md §4.1 Nav shell (role-aware): tenant mark leads, persistent
// sidebar on desktop, badge/notification slot in the top bar.
export function SidebarShell({ navItems, tenantLabel, children }: SidebarShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-border bg-surface-sunk px-4 py-6">
        <div>
          <div className="mb-6 font-display text-base font-semibold text-text">{tenantLabel}</div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={[
                    'min-h-11 rounded-sm px-3 py-2 text-sm font-medium',
                    active ? 'bg-primary text-text' : 'text-text-muted hover:bg-surface hover:text-text',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
        >
          Sign out
        </Button>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
