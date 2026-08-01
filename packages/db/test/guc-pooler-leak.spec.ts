import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { withTenantTx, equipment } from '../src/index.js';
import { directSql, getTenantId } from './helpers.js';

// RFC-1's named top hazard: a pooled (Supavisor) connection must not carry
// one request's tenant GUC into the next. local=true binds the GUC to the
// transaction, so it must reset at commit even if the underlying TCP
// connection is reused by the pool. This is why the plan requires Supabase
// cloud, not Docker Postgres, for this specific test.
describe('withTenantTx: no GUC leak across sequential pooled transactions', () => {
  const direct = directSql();
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    tenantAId = await getTenantId(direct, 'test-tenant-a');
    tenantBId = await getTenantId(direct, 'test-tenant-b');
  });

  afterAll(() => direct.end());

  it('back-to-back requests as tenant A then tenant B never see each other\'s rows', async () => {
    for (let i = 0; i < 5; i++) {
      const aRows = await withTenantTx(
        { tenantId: tenantAId, userId: tenantAId, role: 'admin' },
        (tx) => tx.select({ tenantId: equipment.tenantId }).from(equipment),
      );
      expect(aRows.every((r) => r.tenantId === tenantAId)).toBe(true);

      const bRows = await withTenantTx(
        { tenantId: tenantBId, userId: tenantBId, role: 'admin' },
        (tx) => tx.select({ tenantId: equipment.tenantId }).from(equipment),
      );
      expect(bRows.every((r) => r.tenantId === tenantBId)).toBe(true);
    }
  });

  it('a transaction that throws still leaves no residual GUC for the next caller', async () => {
    await expect(
      withTenantTx({ tenantId: tenantAId, userId: tenantAId, role: 'admin' }, async (tx) => {
        await tx.select().from(equipment).where(eq(equipment.tenantId, tenantAId));
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const rows = await withTenantTx(
      { tenantId: tenantBId, userId: tenantBId, role: 'admin' },
      (tx) => tx.select({ tenantId: equipment.tenantId }).from(equipment),
    );
    expect(rows.every((r) => r.tenantId === tenantBId)).toBe(true);
  });
});
