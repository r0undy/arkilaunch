import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { registerTenant } from '@arkilaunch/db';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { CatalogService } from '../src/catalog/catalog.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

// The storefront tenant now comes from the request host (migration 0048),
// so a slug is visitor-chosen: only an ACTIVE tenant may ever answer.
describe('host-resolved storefront tenant', () => {
  const catalog = new CatalogService();
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());

  it('names an active tenant and 404s an unknown one', async () => {
    await expect(catalog.getTenant('test-tenant-a')).resolves.toMatchObject({ name: expect.any(String) });
    await expect(catalog.getTenant(`nope-${randomUUID().slice(0, 8)}`)).rejects.toThrow(NotFoundException);
  });

  it('serves nothing and refuses signup for a tenant still under review', async () => {
    const slug = `pending-${randomUUID().slice(0, 8)}`;
    await registerTenant({
      legalName: 'Pending Co',
      slug,
      ownerEmail: `${slug}@host-tenant.test`,
      placeholderPasswordHash: 'x',
      companyName: 'Pending Co',
      businessAddress: 'Quezon City',
      secNumber: 'CS201912345',
      tin: '123-456-789-000',
      contactFirstName: 'Pat',
      contactLastName: 'Ending',
      contactMobile: '09170000000',
      contactJobTitle: 'Owner',
    });

    await expect(catalog.getTenant(slug)).rejects.toThrow(NotFoundException);
    await expect(catalog.listEquipment(slug, { limit: 10, offset: 0 })).resolves.toEqual({ items: [] });
    await expect(
      auth.registerCustomer({ email: `c-${slug}@host-tenant.test`, password: 'a long enough password', acceptedTerms: true }, slug),
    ).rejects.toThrow(NotFoundException);
  });
});
