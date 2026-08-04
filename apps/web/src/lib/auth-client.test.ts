import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every case rewires window.location.assign for a spy without needing a
// jsdom navigation, and clears sessionStorage between tests since
// auth-client's module-level `inflightRefresh` is per-module-instance but
// sessionStorage state must not leak across cases.
describe('authorizedFetch: 401 handling', () => {
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
    assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy, pathname: '/app/inventory', search: '' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits the Authorization header when unauthenticated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { authorizedFetch } = await import('./auth-client.js');

    await authorizedFetch('/reference/customers');

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('three concurrent 401s trigger exactly one POST /auth/refresh, and all three succeed on retry', async () => {
    sessionStorage.setItem('arkilaunch.accessToken', 'stale-token');
    sessionStorage.setItem('arkilaunch.refreshToken', 'refresh-token-1');

    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({ accessToken: 'fresh-token', refreshToken: 'refresh-token-2', expiresIn: 600 }),
            { status: 200 },
          ),
        );
      }
      // Every request carrying the stale token 401s; the retry carrying the
      // fresh token (post-refresh) succeeds.
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Authorization === 'Bearer fresh-token') {
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 401 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { authorizedFetch } = await import('./auth-client.js');

    const results = await Promise.all([
      authorizedFetch('/a'),
      authorizedFetch('/b'),
      authorizedFetch('/c'),
    ]);

    expect(refreshCalls).toBe(1);
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });

  it('a failed refresh clears tokens and redirects to /login exactly once', async () => {
    sessionStorage.setItem('arkilaunch.accessToken', 'stale-token');
    sessionStorage.setItem('arkilaunch.refreshToken', 'dead-refresh-token');

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve(new Response('{"error":"refresh_reuse_detected"}', { status: 401 }));
      }
      return Promise.resolve(new Response('{}', { status: 401 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { authorizedFetch } = await import('./auth-client.js');

    await authorizedFetch('/a');

    expect(sessionStorage.getItem('arkilaunch.accessToken')).toBeNull();
    expect(sessionStorage.getItem('arkilaunch.refreshToken')).toBeNull();
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy.mock.calls[0]![0]).toContain('/login?redirect=');
  });

  it('a persistent 401 with no refresh token does not loop', async () => {
    sessionStorage.setItem('arkilaunch.accessToken', 'stale-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { authorizedFetch } = await import('./auth-client.js');

    const res = await authorizedFetch('/a');

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
