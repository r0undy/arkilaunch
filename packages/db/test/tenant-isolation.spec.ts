import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { directSql, pooledSql, getTenantId, setTenantGuc } from './helpers.js';

// QAD §3: "A test that 'confirms isolation' against a single-tenant
// database proves nothing." Requires `pnpm db:seed:test` to have run
// against this database first.
describe('cross-tenant isolation (two-tenant fixture)', () => {
  const direct = directSql();
  const pooled = pooledSql();
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    tenantAId = await getTenantId(direct, 'test-tenant-a');
    tenantBId = await getTenantId(direct, 'test-tenant-b');
  });

  afterAll(async () => {
    await direct.end();
    await pooled.end();
  });

  it('no GUC set: app_authenticated never sees another tenant\'s rows (fail-closed)', async () => {
    // Supavisor's transaction-mode pooler does not reliably reset a custom
    // GUC to NULL between logical sessions on a reused physical connection
    // (verified directly against this project: it lands on '' instead).
    // '' cannot cast to uuid, so the policy check errors rather than
    // silently matching -- an even stronger fail-closed outcome than an
    // empty result set. Either outcome is acceptable; returning real rows
    // is not.
    await setTenantGuc(pooled, null);
    try {
      const rows = await pooled`select id from equipment`;
      expect(rows).toHaveLength(0);
    } catch (err) {
      expect(String(err)).toMatch(/invalid input syntax for type uuid/);
    }
  });

  it('tenant A context: reads only tenant A equipment, never tenant B rows', async () => {
    await setTenantGuc(pooled, tenantAId);
    const rows = await pooled<{ tenant_id: string }[]>`select tenant_id from equipment`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantAId);
    }
  });

  it('tenant A context: a write targeting tenant B rows affects zero rows', async () => {
    await setTenantGuc(pooled, tenantAId);
    const result = await pooled`
      update equipment set model = 'tenant-a-cannot-write-this' where tenant_id = ${tenantBId}
    `;
    expect(result.count).toBe(0);
  });

  it('tenant A context: cannot insert a row claiming tenant B (WITH CHECK)', async () => {
    await setTenantGuc(pooled, tenantAId);
    const [equipmentType] = await direct`select id from equipment_types limit 1`;
    await expect(
      pooled`
        insert into equipment (tenant_id, equipment_type_id, model, serial_no)
        values (${tenantBId}, ${(equipmentType as { id: string }).id}, 'forged', 'forged-serial')
      `,
    ).rejects.toThrow();
  });
});
