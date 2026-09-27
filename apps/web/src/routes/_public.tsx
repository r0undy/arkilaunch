import { createRoute, Link, Outlet, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { rootRoute } from './__root.js';
import { onlyOn } from '../lib/guards.js';
import { useTenant } from '../lib/tenant.js';
import { FloatingNav } from '../components/floating-nav.js';
import { SkipLink } from '../components/skip-link.js';
import { FacebookIcon } from '../components/icons.js';

type FooterTo = NonNullable<LinkProps['to']>;

const FOOTER_COLUMNS: { title: string; links: { label: string; to: FooterTo }[] }[] = [
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
      { label: 'Register', to: '/signup' },
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

// The public chrome (DSD §4, the AWS reference): steel top nav, the page on
// the paper canvas, a steel footer with faded links. Exported so the
// storefront layout reuses it for signed-out visitors -- /equipment renders
// this chrome or the account shell depending on who is looking.
export function MarketingChrome({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const tenantName = tenant?.name ?? '';
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SkipLink />
      <FloatingNav />
      <main id="main" className="mx-auto w-full max-w-shell flex-1">
        {children}
      </main>
      <footer className="bg-nav text-text-inverse">
        <div className="mx-auto flex max-w-shell flex-col gap-10 px-4 py-10 sm:flex-row sm:justify-between sm:px-8">
          <div>
            <p className="flex items-center gap-3 text-heading-md">
              {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-10 w-auto max-w-[140px] rounded-xs bg-white object-contain p-1" />}
              {tenantName}
            </p>
            <p className="mt-2 text-sm text-text-inverse/70">
              {tenantName} &copy; 2026. All rights reserved. Powered by ArkiLaunch.
            </p>
            {tenant?.facebookUrl && (
              <div className="mt-4">
                <p className="text-sm font-medium">Follow us</p>
                <a
                  href={tenant.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm text-text-inverse/70 hover:text-text-inverse hover:underline"
                >
                  <FacebookIcon className="h-5 w-5" />
                  Facebook
                </a>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-sm font-medium">{col.title}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {col.links.map((link) => (
                    <li key={link.to}>
                      {/* Router Link, not a bare anchor: every footer click
                          used to be a full page reload. */}
                      <Link
                        to={link.to}
                        className="text-sm text-text-inverse/70 hover:text-text-inverse hover:underline"
                      >
                        {link.label}
                      </Link>
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

function PublicLayout() {
  return (
    <MarketingChrome>
      <Outlet />
    </MarketingChrome>
  );
}

export const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public-layout',
  beforeLoad: onlyOn('tenant'),
  component: PublicLayout,
});
