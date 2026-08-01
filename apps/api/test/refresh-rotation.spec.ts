import { describe, expect, it, beforeAll } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import postgres from 'postgres';
import { auditLogs, withTenantTx } from '@arkilaunch/db';
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
    const [user] = await sql`
      select id from users where tenant_id = ${(tenant as { id: string }).id} limit 1
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
});
