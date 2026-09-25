import { describe, expect, it } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import postgres from 'postgres';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { TenantsService } from '../src/tenants/tenants.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

// The /admin Companies page (migration 0048): a tenant-level list with
// counts, and a status switch that really cuts a company off. Files run
// one at a time (vitest.config.ts), so suspending test-tenant-b here cannot
// race another spec; `finally` always restores it.
describe('platform companies', () => {
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
  const tenants = new TenantsService(auth);
  const catalog = new CatalogService();

  it('lists companies with counts and never the platform tenant', async () => {
    const { items } = await tenants.listCompanies();
    const a = items.find((c) => c.slug === 'test-tenant-a');
    expect(a).toMatchObject({ status: 'active' });
    expect(a!.usersCount).toBeGreaterThan(0);
    expect(items.some((c) => c.slug === 'arkilaunch-platform')).toBe(false);
  });

  it('deactivating a company blocks sign-in, session renewal and its storefront', async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const [b] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const [actor] = await sql`select u.id from users u join tenants t on t.id = u.tenant_id where t.slug = 'test-tenant-a' limit 1`;
    await sql.end();
    const ctx = { tenantId: 'unused', userId: (actor as { id: string }).id, role: 'platform_admin' };
    const tenantId = (b as { id: string }).id;

    const tokens = (await auth.login({ email: 'admin@test-tenant-b.test', password: 'test-password' }, 'test-tenant-b')) as {
      refreshToken: string;
    };
    try {
      await tenants.setCompanyStatus(ctx as never, tenantId, 'suspended');
      await expect(
        auth.login({ email: 'admin@test-tenant-b.test', password: 'test-password' }, 'test-tenant-b'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(auth.refresh({ refreshToken: tokens.refreshToken })).rejects.toThrow();
      await expect(catalog.getTenant('test-tenant-b')).rejects.toThrow(NotFoundException);
      const { items } = await tenants.listCompanies();
      expect(items.find((c) => c.slug === 'test-tenant-b')?.status).toBe('suspended');
    } finally {
      await tenants.setCompanyStatus(ctx as never, tenantId, 'active');
    }
    await expect(
      auth.login({ email: 'admin@test-tenant-b.test', password: 'test-password' }, 'test-tenant-b'),
    ).resolves.toBeDefined();
  });

  it('refuses the platform tenant and unknown ids', async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const [p] = await sql`select id from tenants where slug = 'arkilaunch-platform'`;
    const [actor] = await sql`select id from users limit 1`;
    await sql.end();
    const ctx = { userId: (actor as { id: string }).id } as never;
    if (p) {
      await expect(tenants.setCompanyStatus(ctx, (p as { id: string }).id, 'suspended')).rejects.toThrow(NotFoundException);
    }
    await expect(
      tenants.setCompanyStatus(ctx, '00000000-0000-4000-8000-000000000000', 'suspended'),
    ).rejects.toThrow(NotFoundException);
  });
});
