import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyTurnstile } from '../src/common/turnstile.js';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';

// Turnstile CR. siteverify is stubbed at the fetch boundary; the flag is
// read per call, so each test flips it on and restores it afterwards.
async function rejection(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return { status: (err as HttpException).getStatus(), body: (err as HttpException).getResponse() };
  }
  throw new Error('expected a rejection');
}

function siteverify(response: () => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_ENABLED', 'true');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('passes a token Cloudflare accepts, sending secret, token and client IP', async () => {
    const fetchMock = siteverify(async () => Response.json({ success: true }));
    await expect(verifyTurnstile('tok', '203.0.113.9')).resolves.toBeUndefined();
    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get('secret')).toBe('test-secret');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.9');
  });

  it('403 captcha_failed when Cloudflare rejects the token', async () => {
    siteverify(async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await rejection(verifyTurnstile('tok', undefined))).toEqual({ status: 403, body: { error: 'captcha_failed' } });
  });

  it('403 captcha_required with no token, without calling Cloudflare', async () => {
    const fetchMock = siteverify(async () => Response.json({ success: true }));
    expect(await rejection(verifyTurnstile(undefined, undefined))).toEqual({ status: 403, body: { error: 'captcha_required' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed (503) when siteverify is unreachable or errors', async () => {
    siteverify(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await rejection(verifyTurnstile('tok', undefined))).toEqual({ status: 503, body: { error: 'captcha_unavailable' } });
    siteverify(async () => new Response('bad gateway', { status: 502 }));
    expect((await rejection(verifyTurnstile('tok', undefined))).status).toBe(503);
  });

  it('is a no-op when the flag is off', async () => {
    vi.stubEnv('TURNSTILE_ENABLED', 'false');
    const fetchMock = siteverify(async () => Response.json({ success: false }));
    await expect(verifyTurnstile(undefined, undefined)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AuthService.login: Turnstile after repeated failures', () => {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  const freshAuth = () =>
    new AuthService(
      new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } }),
      new RefreshTokenService(),
      new TotpService(),
    );
  const email = 'admin@test-tenant-a.test';
  const slug = 'test-tenant-a';

  beforeEach(() => {
    vi.stubEnv('TURNSTILE_ENABLED', 'true');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('first two attempts need no token; the third does, and a valid token lets the right password in', async () => {
    const fetchMock = siteverify(async () => Response.json({ success: true }));
    const auth = freshAuth();
    for (let i = 0; i < 2; i += 1) {
      expect((await rejection(auth.login({ email, password: 'wrong' }, slug, '198.51.100.1'))).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await rejection(auth.login({ email, password: 'test-password' }, slug, '198.51.100.1'))).toEqual({
      status: 403,
      body: { error: 'captcha_required' },
    });
    await expect(auth.login({ email, password: 'test-password' }, slug, '198.51.100.1', 'tok')).resolves.toBeDefined();
  });

  it('counts per IP too: two misses on different emails from one IP gate the next login from it', async () => {
    siteverify(async () => Response.json({ success: true }));
    const auth = freshAuth();
    const ip = '198.51.100.2';
    await rejection(auth.login({ email: 'nobody-1@example.test', password: 'x' }, slug, ip));
    await rejection(auth.login({ email: 'nobody-2@example.test', password: 'x' }, slug, ip));
    expect((await rejection(auth.login({ email, password: 'test-password' }, slug, ip))).body).toEqual({
      error: 'captcha_required',
    });
    // Another IP is unaffected.
    await expect(auth.login({ email, password: 'test-password' }, slug, '198.51.100.3')).resolves.toBeDefined();
  });
});
