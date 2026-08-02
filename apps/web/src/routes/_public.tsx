import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { FloatingNav } from '../components/floating-nav.js';

const FOOTER_COLUMNS = [
  {
    title: 'Use cases',
    links: [
      { label: 'Browse equipment', to: '/equipment' },
      { label: 'My bookings', to: '/account/bookings' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { label: 'Register', to: '/register' },
      { label: 'Sign in', to: '/login' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Contact', to: '/contact' },
      { label: 'Help center', to: '/help' },
      { label: 'Terms of service', to: '/terms' },
      { label: 'Privacy policy', to: '/privacy' },
    ],
  },
];

function PublicLayout() {
  return (
    <div data-tier="marketing" className="min-h-screen bg-bg-mk-frame">
      <div className="mx-auto max-w-shell">
        <FloatingNav />
        <main>
          <Outlet />
        </main>
        <footer className="flex flex-col gap-8 rounded-t-mk-container bg-bg-mk-frame px-6 py-12 sm:flex-row sm:justify-between">
          <div>
            <p className="font-display text-lg font-semibold text-ink-mk">Almara</p>
            <p className="mt-2 text-sm text-text-muted">Almara &copy; 2026. All rights reserved.</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-sm font-semibold text-ink-mk">{col.title}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {col.links.map((link) => (
                    <li key={link.to}>
                      <a href={link.to} className="text-sm text-text-muted hover:text-text">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

export const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public-layout',
  component: PublicLayout,
});
