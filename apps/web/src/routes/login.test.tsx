import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { useCart } from '../lib/cart-client.js';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken, getAccessToken, login } from '../lib/auth-client.js';

// Mock only fetch, not auth-client: login()'s storeTokens() must run or the guards bounce to /login.
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
      // Paginated endpoints must answer the list shape: isEmpty() reads data.items.
      const listShape = /\/(equipment|bookings|quotes|invoices|payments|users|incidents)/.test(
        String(url),
      );
      return Promise.resolve(
        new Response(JSON.stringify(listShape ? { items: [], total: 0 } : []), { status: 200 }),
      );
    }),
  );
}

describe('LoginPage: redirect preservation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // The access token is module state; clearing storage does not reset it.
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a visitor cart on first sign-in but clears it when switching accounts', async () => {
    const first = makeToken(makeValidClaims({ sub: 'customer-1' }));
    sessionStorage.setItem('arkilaunch.cart', '[{"equipmentId":"machine-1"}]');
    stubFetch({ accessToken: first, refreshToken: 'refresh-1', expiresIn: 600 });

    await login({ email: 'first@example.com', password: 'password123' });
    expect(sessionStorage.getItem('arkilaunch.cart')).toContain('machine-1');

    const second = makeToken(makeValidClaims({ sub: 'customer-2' }));
    stubFetch({ accessToken: second, refreshToken: 'refresh-2', expiresIn: 600 });
    const { result } = renderHook(() => useCart());
    expect(result.current).toHaveLength(1);
    await act(() => login({ email: 'second@example.com', password: 'password123' }));
    expect(sessionStorage.getItem('arkilaunch.cart')).toBeNull();
    expect(result.current).toHaveLength(0);
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
