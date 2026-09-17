import { describe, expect, it } from 'vitest';
import { routeTree } from './router.js';
import { ACCOUNT_NAV, APP_NAV, FIELD_NAV, PLATFORM_ADMIN_NAV } from './lib/nav-config.js';

/**
 * Every path the route tree actually serves.
 *
 * Reads `fullPath`, not `path`: the router normalises a child's `path` (it
 * stores "equipment", not "/equipment"), while `fullPath` is the URL the
 * route really answers on. Layout routes are pathless and resolve to the
 * prefix they wrap, which is harmless here -- this set is only ever asked
 * whether a given link target is present.
 */
function registeredPaths(route: { fullPath?: string; children?: unknown }): string[] {
  const children = (route.children ?? []) as { fullPath?: string; children?: unknown }[];
  const here = typeof route.fullPath === 'string' ? [route.fullPath] : [];
  return [...here, ...children.flatMap(registeredPaths)];
}

// The sidebar is assembled by hand in nav-config.ts and the routes are
// registered by hand in router.tsx, in two different files. Nothing stopped
// a nav entry pointing at a path nobody registered -- which renders as a
// dead link that looks exactly like a working one until it is clicked. The
// IA alignment pass added 20-odd routes across three shells at once, so the
// two lists are now worth pinning to each other.
describe('navigation targets resolve to registered routes', () => {
  const paths = new Set(registeredPaths(routeTree as never));

  const navTargets = [
    ...APP_NAV.flatMap((group) => group.items),
    ...ACCOUNT_NAV.flatMap((group) => group.items),
    ...PLATFORM_ADMIN_NAV.flatMap((group) => group.items),
    ...FIELD_NAV,
  ];

  it.each(navTargets.map((item) => [item.label, item.to]))(
    'nav item "%s" points at %s, which is registered',
    (_label, to) => {
      expect(paths).toContain(to);
    },
  );

  it('registers the screens the Figma alignment pass added', () => {
    for (const path of [
      '/account/invoices/$invoiceId',
      '/account/checkout/$bookingId',
      '/account/checkout/success',
      '/account/bookings/$bookingId',
      '/app/billing/weekly',
      '/app/companies/pending',
      '/app/companies/$applicationId',
      '/app/registration/review',
      '/app/security-logs',
      '/field/profile',
    ]) {
      expect(paths).toContain(path);
    }
  });
});
