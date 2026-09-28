import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import postgres from 'postgres';
import type { RequestContext } from '@arkilaunch/shared';
import { UsersService } from '../src/users/users.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { EventsService } from '../src/events/events.service.js';
import { TenantsService } from '../src/tenants/tenants.service.js';
import type { StorageService } from '../src/storage/storage.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

// CR: global-email-unique (migration 0063). One login per email across
// every tenant, with Gmail's dot and +tag aliases counted as one address.
describe('one account per email', () => {
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
  const tenants = new TenantsService(auth, null as never);
  const users = new UsersService(auth, new RefreshTokenService(), new EventsService(), {} as StorageService);

  it('refuses the same Gmail, however it is written, in every signup path', async () => {
    const id = randomUUID().slice(0, 8);
    await auth.registerCustomer({ email: `juan.dc${id}@gmail.com`, password: 'a long enough password', acceptedTerms: true }, 'test-tenant-a');
    const alias = `JuanDC${id}+rentals@googlemail.com`;

    await expect(
      auth.registerCustomer({ email: alias, password: 'a long enough password', acceptedTerms: true }, 'test-tenant-b'),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      tenants.register({
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        mobileNumber: '09170000000',
        email: alias,
        jobTitle: 'Owner',
        companyName: `Alias Rentals ${id}`,
        businessAddress: 'Pasig',
        secNumber: 'CS201912345',
        tin: '123-456-789-000',
      }),
    ).rejects.toMatchObject({ response: { error: 'email_taken' } });

    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
      const [adminB] = await sql`select id from users where email = 'admin@test-tenant-b.test'`;
      const ctx: RequestContext = { tenantId: (tenantB as { id: string }).id, userId: (adminB as { id: string }).id, role: 'admin' };
      await expect(users.invite(ctx, { email: alias, role: 'timekeeper' })).rejects.toBeInstanceOf(ConflictException);

      // The index holds even for a write that skips every function.
      const [role] = await sql`select id from roles where name = 'customer'`;
      await expect(
        sql`insert into users (tenant_id, role_id, email, password_hash)
            values (${ctx.tenantId}, ${(role as { id: string }).id}, ${`juan.d.c${id}@gmail.com`}, 'x')`,
      ).rejects.toMatchObject({ code: '23505', constraint_name: 'users_email_key_uq' });

      const [key] = await sql`select email_key(${' J.Uan+x@GoogleMail.com '}) as k, email_key('A.B@Example.com') as other`;
      expect(key).toEqual({ k: 'juan@gmail.com', other: 'a.b@example.com' });
    } finally {
      await sql.end();
    }
  });
});
