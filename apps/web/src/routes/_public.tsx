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

// The marketing shell used to be a padded, rounded "floating card" (outer
// frame padding + rounded-mk-container on an inner wrapper). That meant the
// nav and footer never actually reached the viewport's top/bottom/side
// edges -- and the padding gap let the frame's own background peek through
// during scroll overscroll, which read as a stray color flash. Nav and
// footer are now full-bleed, sitting directly on the marketing frame
// background; only the page's own content (via each route + the footer's
// inner row) is width-capped with max-w-shell.
function PublicLayout() {
  return (
    <div data-tier="marketing" className="flex min-h-screen flex-col bg-bg-mk-frame">
      <FloatingNav />
      <main className="mx-auto w-full max-w-shell flex-1 bg-bg-mk shadow-mk-inset">
        <Outlet />
      </main>
      <footer className="bg-surface-mk">
        <div className="mx-auto flex max-w-shell flex-col gap-8 px-6 py-12 sm:flex-row sm:justify-between">
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
        </div>
      </footer>
    </div>
  );
}

export const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public-layout',
  component: PublicLayout,
});
