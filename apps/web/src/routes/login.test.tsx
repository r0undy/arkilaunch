import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken, getAccessToken } from '../lib/auth-client.js';

// The route-level pattern to copy for future screens: drive the real route
// tree through createMemoryHistory and mock only the network boundary
// (global fetch), not auth-client itself -- login()'s storeTokens() side
// effect must actually run, or the route guards downstream (which read
// sessionStorage) bounce the navigation right back to /login.
// Only /auth/login gets the crafted response; every other endpoint (the
// destination page's own data fetch, e.g. GET /equipment) gets an empty
// array so navigating there doesn't also need its own fixture.
function stubFetch(loginResponse: unknown, status = 200, verify2faResponse?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/login')) {
        return Promise.resolve(new Response(JSON.stringify(loginResponse), { status }));
      }
      if (String(url).includes('/auth/2fa/verify')) {
        return Promise.resolve(new Response(JSON.stringify(verify2faResponse ?? {}), { status: 200 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    }),
  );
}

describe('LoginPage: redirect preservation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Access token now lives in a module-level variable (RFC-1 §3), not
    // sessionStorage, so clearing storage alone no longer resets it between
    // tests in this file.
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('after a successful login, navigates back to the ?redirect= destination rather than the role home', async () => {
    // /app/inventory's beforeLoad requires role admin/owner/platform_admin,
    // so the fake accessToken must decode to one of those roles.
    const accessToken = makeToken(makeValidClaims({ role: 'admin' }));
    stubFetch({ accessToken, refreshToken: 'b', expiresIn: 600 });

    const { router } = await renderRoute('/login?redirect=%2Fapp%2Finventory');

    await userEvent.type(screen.getByLabelText(/email address/i), 'admin@test-tenant-a.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /sign in to system/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/inventory'));
  });

  it('a 2FA challenge switches to a code-entry step, and verifying signs in', async () => {
    const accessToken = makeToken(makeValidClaims({ role: 'timekeeper' }));
    stubFetch(
      { requires2fa: true, twoFaToken: 'challenge-token' },
      200,
      { accessToken, refreshToken: 'b', expiresIn: 600 },
    );

    const { router } = await renderRoute('/login');

    await userEvent.type(screen.getByLabelText(/email address/i), 'timekeeper@test-tenant-a.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /sign in to system/i }));

    await waitFor(() => expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument());
    expect(getAccessToken()).toBeNull();

    await userEvent.type(screen.getByLabelText(/verification code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/field'));
  });
});
