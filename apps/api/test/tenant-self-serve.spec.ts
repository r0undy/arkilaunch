import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { registerTenant } from '@arkilaunch/db';
import { TenantBrandingUpdateRequestSchema } from '@arkilaunch/shared';
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

const branding = {
  primaryColor: '#1e5f8c',
  tagline: 'Cranes on time',
  about: null,
  phone: '09170000000',
  contactEmail: null,
  address: null,
  city: 'Cebu City',
  province: 'Cebu',
};

// CR: tenant-self-serve-branding (migration 0051). Registration is
// auto-approved, owner activation takes the company live, branding is
// editable except the name, and the directory lists only active companies.
describe('self-serve rental company', () => {
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
  const tenants = new TenantsService(auth, null as never);
  const catalog = new CatalogService();

  it('goes live on owner activation, shows its branding, and leaves the directory when suspended', async () => {
    const slug = `self-${randomUUID().slice(0, 8)}`;
    const reg = await registerTenant({
      legalName: 'Self Serve Rentals',
      slug,
      ownerEmail: `${slug}@self-serve.test`,
      placeholderPasswordHash: 'placeholder',
      companyName: 'Self Serve Rentals',
      businessAddress: 'Cebu City',
      secNumber: 'CS201912345',
      tin: '123-456-789-000',
      contactFirstName: 'Sam',
      contactLastName: 'Serve',
      contactMobile: '09170000000',
      contactJobTitle: 'Owner',
    });

    // Auto-approved, but not live until the owner proves the email.
    await expect(catalog.getTenant(slug)).rejects.toThrow(NotFoundException);

    const token = auth.signActivationToken(reg.tenantId, reg.ownerUserId, 'placeholder');
    await auth.activate({ activationToken: token, password: 'a long enough password' });
    await expect(catalog.getTenant(slug)).resolves.toMatchObject({ name: 'Self Serve Rentals' });

    const ctx = { tenantId: reg.tenantId, userId: reg.ownerUserId, role: 'owner' };
    const saved = await tenants.updateBranding(ctx as never, reg.tenantId, branding);
    expect(saved).toMatchObject({ legalName: 'Self Serve Rentals', tagline: 'Cranes on time', province: 'Cebu' });
    await expect(catalog.getTenant(slug)).resolves.toMatchObject({ primaryColor: '#1e5f8c', city: 'Cebu City' });

    const found = await catalog.listTenants({ q: 'self serve', location: 'cebu', limit: 50, offset: 0 });
    expect(found.items.map((t) => t.slug)).toContain(slug);
    const otherProvince = await catalog.listTenants({ q: 'self serve', location: 'Davao', limit: 50, offset: 0 });
    expect(otherProvince.items.map((t) => t.slug)).not.toContain(slug);

    await tenants.setCompanyStatus(ctx as never, reg.tenantId, 'suspended');
    const afterSuspend = await catalog.listTenants({ q: 'self serve', limit: 50, offset: 0 });
    expect(afterSuspend.items.map((t) => t.slug)).not.toContain(slug);
    await expect(catalog.getTenant(slug)).rejects.toThrow(NotFoundException);
  });

  it('never lists the platform tenant or the fixtures', async () => {
    const { items } = await catalog.listTenants({ limit: 100, offset: 0 });
    const slugs = items.map((t) => t.slug);
    expect(slugs).not.toContain('arkilaunch-platform');
    expect(slugs).not.toContain('test-tenant-a');
  });

  it('keeps the company name locked', () => {
    expect(TenantBrandingUpdateRequestSchema.safeParse({ ...branding, legalName: 'Renamed' }).success).toBe(false);
    expect(TenantBrandingUpdateRequestSchema.safeParse({ ...branding, slug: 'renamed' }).success).toBe(false);
    expect(TenantBrandingUpdateRequestSchema.safeParse({ ...branding, primaryColor: 'red' }).success).toBe(false);
  });
});
