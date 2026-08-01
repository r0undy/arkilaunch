import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { pooledSql, directSql, getTenantId, setTenantGuc } from './helpers.js';

// SDD §3: "audit_logs is append-only: no UPDATE or DELETE grant to the
// application role... that immutability is what lets an invoice cite the
// exact reconciliation ... behind a deduction."
describe('audit_logs is append-only for app_authenticated', () => {
  const pooled = pooledSql();
  const direct = directSql();
  let tenantAId: string;

  beforeAll(async () => {
    tenantAId = await getTenantId(direct, 'test-tenant-a');
    await setTenantGuc(pooled, tenantAId);
  });

  afterAll(async () => {
    await pooled.end();
    await direct.end();
  });

  it('rejects UPDATE', async () => {
    await expect(pooled`update audit_logs set action = 'TAMPERED'`).rejects.toThrow();
  });

  it('rejects DELETE', async () => {
    await expect(pooled`delete from audit_logs`).rejects.toThrow();
  });
});
