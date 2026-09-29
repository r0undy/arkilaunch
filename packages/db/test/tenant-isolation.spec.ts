import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { directSql, pooledSql, getTenantId, setTenantGuc } from './helpers.js';

// QAD §3: isolation needs two tenants. Requires `pnpm db:seed:test` first.
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
    // Supavisor may leave a reused connection's GUC at '' instead of NULL; ''::uuid errors,
    // which is also fail-closed. Returning real rows is the only failure.
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

  it('tenant A context: reads only tenant A maintenance_logs, never tenant B rows', async () => {
    await setTenantGuc(pooled, tenantAId);
    const rows = await pooled<{ tenant_id: string }[]>`select tenant_id from maintenance_logs`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantAId);
    }
  });

  it('tenant A context: reads only tenant A weather_alerts, never tenant B rows', async () => {
    await setTenantGuc(pooled, tenantAId);
    const rows = await pooled<{ tenant_id: string }[]>`select tenant_id from weather_alerts`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantAId);
    }
  });
});
