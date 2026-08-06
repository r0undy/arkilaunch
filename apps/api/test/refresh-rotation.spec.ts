import { describe, expect, it, beforeAll } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import postgres from 'postgres';
import { auditLogs, users, withTenantTx } from '@arkilaunch/db';
import { eq } from 'drizzle-orm';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';

// RFC1-06 / QAD abuse gate: a refresh token replayed after rotation must
// revoke the entire family and write a refresh_reuse_detected audit row.
describe('RefreshTokenService: rotation and reuse detection', () => {
  const service = new RefreshTokenService();
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    // Filtered by the seed's own fixed email, not a bare unordered `limit
    // 1` -- other spec files (e.g. users-admin.spec.ts) insert many more
    // tenant-A user rows at runtime (mostly status='invited'), and an
    // unordered query could nondeterministically pick one of those instead
    // of the seed's active admin, which would then spuriously trip this
    // file's own user_inactive check.
    const [user] = await sql`
      select id from users where tenant_id = ${(tenant as { id: string }).id} and email = 'admin@test-tenant-a.test'
    `;
    tenantId = (tenant as { id: string }).id;
    userId = (user as { id: string }).id;
    await sql.end();
  });

  it('rotating an active token issues a new one and marks the old one rotated', async () => {
    const first = await service.issue(tenantId, userId, 'admin');
    const rotated = await service.rotate(first.token);
    expect(rotated.tenantId).toBe(tenantId);
    expect(rotated.issued.token).not.toBe(first.token);

    // Replaying the now-rotated first token must fail.
    await expect(service.rotate(first.token)).rejects.toThrow(UnauthorizedException);
  });

  it('replaying a rotated token revokes the whole family and audits it', async () => {
    const issued = await service.issue(tenantId, userId, 'admin');
    const rotated = await service.rotate(issued.token);

    await expect(service.rotate(issued.token)).rejects.toThrow('refresh_reuse_detected');

    // The rotated successor must also now be unusable (family revoked).
    await expect(service.rotate(rotated.issued.token)).rejects.toThrow();

    const rows = await withTenantTx({ tenantId, userId, role: 'admin' }, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, 'refresh_reuse_detected')),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('an unknown token is rejected without leaking which part was wrong', async () => {
    await expect(service.rotate('not-a-real-token')).rejects.toThrow(UnauthorizedException);
  });

  describe('deactivation takes effect immediately, not after the token expires', () => {
    // A DEDICATED user, never the shared seed admin: other spec files
    // (e.g. auth-lockout.spec.ts) log in as admin@test-tenant-a.test
    // concurrently, and flipping its status here would race them.
    let dedicatedUserId: string;

    beforeAll(async () => {
      const url = process.env.DATABASE_URL_DIRECT;
      if (!url) throw new Error('DATABASE_URL_DIRECT is required');
      const sql = postgres(url, { max: 1 });
      const [adminRole] = await sql`select id from roles where name = 'admin'`;
      const [adminHashRow] = await sql`select password_hash from users where id = ${userId}`;
      const passwordHash = (adminHashRow as { password_hash: string }).password_hash;
      const [row] = await sql`
        insert into users (tenant_id, role_id, email, password_hash, status)
        values (${tenantId}, ${(adminRole as { id: string }).id}, ${`refresh-rotation-fixture-${Date.now()}@test-tenant-a.test`}, ${passwordHash}, 'active')
        returning id
      `;
      dedicatedUserId = (row as { id: string }).id;
      await sql.end();
    });

    it('a deactivated user cannot rotate an outstanding refresh token', async () => {
      const issued = await service.issue(tenantId, dedicatedUserId, 'admin');
      await withTenantTx({ tenantId, userId: dedicatedUserId, role: 'admin' }, (tx) =>
        tx.update(users).set({ status: 'disabled' }).where(eq(users.id, dedicatedUserId)),
      );

      await expect(service.rotate(issued.token)).rejects.toThrow('user_inactive');
    });

    it('revokeAllForUser revokes every outstanding family for the target', async () => {
      const a = await service.issue(tenantId, dedicatedUserId, 'admin');
      const b = await service.issue(tenantId, dedicatedUserId, 'admin');

      await service.revokeAllForUser({ tenantId, userId: dedicatedUserId, role: 'admin' }, dedicatedUserId);

      await expect(service.rotate(a.token)).rejects.toThrow(UnauthorizedException);
      await expect(service.rotate(b.token)).rejects.toThrow(UnauthorizedException);
    });
  });
});
