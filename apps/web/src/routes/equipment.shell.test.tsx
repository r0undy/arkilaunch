import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken, clearTokens } from '../lib/auth-client.js';

// THE BUG THIS PINS: /equipment lived under the marketing layout, but the
// account sidebar's "Browse equipment" points straight at it. One click and a
// signed-in customer lost their sidebar, app bar, notification bell and cart,
// and the only way back was a full page reload. Figma 185:1599 draws this page
// inside the customer shell.
//
// Same URL either way -- shared links and crawlers keep working; only the
// chrome changes. These drive the real route tree, so a regression in
// router.tsx or in _storefront.tsx fails here rather than in a browser.

const CATALOG = { items: [] };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes('/users/me') ? { tenantName: 'Almara' } : CATALOG),
          { status: 200 },
        ),
      ),
    ),
  );
}

describe('/equipment chrome', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearTokens();
  });

  it('keeps the customer shell when signed in', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    const { unmount } = await renderRoute('/equipment');

    // The sidebar landmark is the tell. Not the link labels: the marketing
    // footer links "My bookings" too, so a name query cannot tell the shells
    // apart -- which is exactly the trap this test exists to catch.
    await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument());
    expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    // App bar, not the marketing nav.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    unmount();
  });

  it('stays the public storefront when signed out', async () => {
    stubFetch();
    const { unmount } = await renderRoute('/equipment');

    // Scoped to the header landmark: the footer links Register and Sign in
    // too, and an unscoped query cannot tell the two apart.
    await waitFor(() => expect(screen.getByRole('banner')).toBeInTheDocument());
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: 'Register' })).toBeInTheDocument();
    expect(header.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(header.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    unmount();
  });

  // The catalog's cards are built from the marketing token tier, which
  // index.css scopes to [data-tier="marketing"]. Render them outside that
  // attribute and every -mk utility resolves to nothing: the grid comes out
  // unstyled, with no error anywhere. Silent, so it gets a test.
  it('carries the marketing token tier into the signed-in shell', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    const { container, unmount } = await renderRoute('/equipment');

    await waitFor(() => expect(container.querySelector('[data-tier="marketing"]')).not.toBeNull());
    const heading = await screen.findByRole('heading', { name: /equipment for hire/i });
    expect(heading.closest('[data-tier="marketing"]')).not.toBeNull();
    unmount();
  });

  it('is reachable signed out without being bounced to login', async () => {
    stubFetch();
    const { router, unmount } = await renderRoute('/equipment');
    expect(router.state.location.pathname).toBe('/equipment');
    unmount();
  });

  // The detail page shares the layout deliberately: leaving it marketing-only
  // would drop the customer out of the shell one click into the page above.
  it('applies the same rule to the unit detail page', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    const { unmount } = await renderRoute('/equipment/11111111-1111-1111-1111-111111111111');
    await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument());
    unmount();
  });
});
