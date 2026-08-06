import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { makeToken, makeValidClaims } from '../test/make-token.js';

async function catchRedirect(fn: () => Promise<unknown>) {
  try {
    await fn();
    throw new Error('expected a redirect to be thrown');
  } catch (err) {
    if (!isRedirect(err)) throw err;
    return err as { options: { to?: string; search?: { redirect?: string } } };
  }
}

describe('requireAuth / requireRole', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no token: redirects to /login carrying the attempted location', async () => {
    const { requireAuth } = await import('./guards.js');
    const guard = requireAuth();

    const err = await catchRedirect(() =>
      guard({ location: { href: '/app/inventory' } } as never),
    );

    expect(err.options.to).toBe('/login');
    expect(err.options.search).toEqual({ redirect: '/app/inventory' });
  });

  it('expired token, no refresh token: redirects to /login with the attempted location', async () => {
    sessionStorage.setItem(
      'arkilaunch.accessToken',
      makeToken(makeValidClaims({ exp: Math.floor(Date.now() / 1000) - 60 })),
    );
    const { requireAuth } = await import('./guards.js');
    const guard = requireAuth();

    const err = await catchRedirect(() =>
      guard({ location: { href: '/app/inventory' } } as never),
    );

    expect(err.options.to).toBe('/login');
    expect(err.options.search).toEqual({ redirect: '/app/inventory' });
  });

  it('expired token, valid refresh token: resolves without redirecting, refreshing exactly once', async () => {
    sessionStorage.setItem(
      'arkilaunch.accessToken',
      makeToken(makeValidClaims({ exp: Math.floor(Date.now() / 1000) - 60 })),
    );
    sessionStorage.setItem('arkilaunch.refreshToken', 'a-valid-refresh-token');

    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        refreshCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({ accessToken: 'fresh-token', refreshToken: 'refresh-token-2', expiresIn: 600 }),
            { status: 200 },
          ),
        );
      }),
    );

    const { requireAuth } = await import('./guards.js');
    const guard = requireAuth();

    await expect(guard({ location: { href: '/app/inventory' } } as never)).resolves.toBeUndefined();
    expect(refreshCalls).toBe(1);
  });

  it('valid token, matching role: resolves without redirecting', async () => {
    sessionStorage.setItem('arkilaunch.accessToken', makeToken(makeValidClaims({ role: 'admin' })));
    const { requireRole } = await import('./guards.js');
    const guard = requireRole('admin', 'owner');

    await expect(guard({ location: { href: '/app' } } as never)).resolves.toBeUndefined();
  });

  it('valid token, wrong role: redirects to the role home WITHOUT a redirect param (no loop)', async () => {
    sessionStorage.setItem('arkilaunch.accessToken', makeToken(makeValidClaims({ role: 'timekeeper' })));
    const { requireRole } = await import('./guards.js');
    const guard = requireRole('admin', 'owner');

    const err = await catchRedirect(() => guard({ location: { href: '/app' } } as never));

    expect(err.options.to).toBe('/field');
    expect(err.options.search).toBeUndefined();
  });
});
