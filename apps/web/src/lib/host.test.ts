import { describe, expect, it } from 'vitest';
import { resolveHost } from './host.js';

describe('resolveHost', () => {
  it('treats bare hosts as the platform', () => {
    expect(resolveHost('localhost')).toEqual({ kind: 'platform' });
    expect(resolveHost('127.0.0.1')).toEqual({ kind: 'platform' });
    expect(resolveHost('arkilaunch.tech')).toEqual({ kind: 'platform' });
  });

  it('maps one label to a tenant', () => {
    expect(resolveHost('almara.localhost')).toEqual({ kind: 'tenant', slug: 'almara' });
    expect(resolveHost('Almara.ArkiLaunch.tech')).toEqual({ kind: 'tenant', slug: 'almara' });
    expect(resolveHost('test-tenant-a.localhost')).toEqual({ kind: 'tenant', slug: 'test-tenant-a' });
  });

  it('never resolves reserved, nested or malformed labels', () => {
    expect(resolveHost('admin.localhost')).toEqual({ kind: 'platform' });
    expect(resolveHost('arkilaunch-platform.localhost')).toEqual({ kind: 'platform' });
    expect(resolveHost('a.b.localhost')).toEqual({ kind: 'platform' });
    expect(resolveHost('-bad.localhost')).toEqual({ kind: 'platform' });
    expect(resolveHost('evil-arkilaunch.tech')).toEqual({ kind: 'platform' });
  });
});
