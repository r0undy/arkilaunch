import { createRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { onlyOn, requireRole } from '../lib/guards.js';
import { clearTokens } from '../lib/auth-client.js';
import { FIELD_NAV } from '../lib/nav-config.js';

// Stripped mobile-first console, short bottom nav, no sidebar (DESIGN.md §4.1
// Nav shell; DSD §6 48px touch targets). "Operator" in the Figma maps to the
// existing timekeeper role -- same shell, relabelled.
function FieldLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen flex-col bg-bg pb-20">
      <header className="flex min-h-14 items-center justify-between bg-nav px-4 py-2 text-text-inverse">
        <span className="text-base font-medium">Operator</span>
        <button
          type="button"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
          className="min-h-12 min-w-12 rounded-sm px-3 text-sm font-medium hover:bg-current/10"
        >
          Sign out
        </button>
      </header>
      <main id="main" className="flex-1 p-4">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 flex border-t border-border bg-surface">
        {FIELD_NAV.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={[
                'flex min-h-12 flex-1 items-center justify-center text-sm font-medium',
                active ? 'border-t-2 border-primary font-semibold text-accent' : 'border-t-2 border-transparent text-text-muted',
              ].join(' ')}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export const fieldLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'field-layout',
  beforeLoad: onlyOn('tenant', requireRole('timekeeper')),
  component: FieldLayout,
});
