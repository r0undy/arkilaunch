import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { directSql, pooledSql, getTenantId, setTenantGuc } from './helpers.js';

// RFC-1 drift guard: enumerates pg_class / pg_policies (what actually landed). A table with a
// tenant_id is tenant-owned; everything else must be named in EXPECTED_GLOBAL_TABLES.
const EXPECTED_GLOBAL_TABLES = [
  'tenants',
  'subscription_plans',
  'roles',
  'permissions',
  'role_permissions',
  'equipment_types',
  // Global DOE price feed (RFC-3): one national series, readable by every tenant.
  'diesel_price_readings',
  // Drizzle's bookkeeping, in case a future config moves it into public.
  '__drizzle_migrations',
];

interface TableRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  has_tenant_id: boolean;
}

interface PolicyRow {
  tablename: string;
  policyname: string;
  roles: string[];
}

describe('RLS is enabled, forced, and policy-covered on every tenant-owned table', () => {
  const sql = directSql();
  let tables: TableRow[] = [];
  let policies: PolicyRow[] = [];

  beforeAll(async () => {
    tables = await sql<TableRow[]>`
      select
        c.relname,
        c.relrowsecurity,
        c.relforcerowsecurity,
        exists (
          select 1
          from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'tenant_id'
        ) as has_tenant_id
      from pg_class c
      where c.relkind = 'r'
        and c.relnamespace = 'public'::regnamespace
      order by c.relname
    `;
    policies = await sql<PolicyRow[]>`
      select tablename, policyname, roles::text[]
      from pg_policies
      where schemaname = 'public' and policyname = 'tenant_isolation'
    `;
  });

  afterAll(() => sql.end());

  it('found tables to check (guards against an empty or unmigrated database)', () => {
    expect(tables.length, 'no public tables found -- did migrations run?').toBeGreaterThan(30);
  });

  it('every public table is either tenant-owned or an expected global table', () => {
    const unclassified = tables
      .filter((t) => !t.has_tenant_id && !EXPECTED_GLOBAL_TABLES.includes(t.relname))
      .map((t) => t.relname);
    expect(
      unclassified,
      `table(s) without a tenant_id and not in EXPECTED_GLOBAL_TABLES: ${unclassified.join(', ')}. ` +
        'Either add tenant_id + tenantIsolationPolicy(), or add the name to the global allowlist ' +
        'with a comment justifying why it is platform-global (RFC-1 §3).',
    ).toEqual([]);
  });

  it('every expected global table actually exists and has no tenant_id', () => {
    const present = new Map(tables.map((t) => [t.relname, t]));
    const misclassified = EXPECTED_GLOBAL_TABLES.filter(
      (name) => present.get(name)?.has_tenant_id === true,
    );
    expect(
      misclassified,
      `allowlisted as global but has a tenant_id column: ${misclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('every tenant-owned table has ENABLE + FORCE row-level security', () => {
    const tenantOwned = tables.filter((t) => t.has_tenant_id);
    expect(tenantOwned.length, 'no tenant-owned tables discovered').toBeGreaterThan(0);

    const notEnabled = tenantOwned.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    const notForced = tenantOwned.filter((t) => !t.relforcerowsecurity).map((t) => t.relname);

    expect(notEnabled, `RLS not enabled on: ${notEnabled.join(', ')}`).toEqual([]);
    // FORCE: without it the table owner is exempt from its own policies.
    expect(
      notForced,
      `RLS not FORCEd (owner would bypass its own policy) on: ${notForced.join(', ')}`,
    ).toEqual([]);
  });

  it('every tenant-owned table has a tenant_isolation policy scoped to app_authenticated', () => {
    const tenantOwned = tables.filter((t) => t.has_tenant_id).map((t) => t.relname);
    const byTable = new Map(policies.map((p) => [p.tablename, p]));

    const missing = tenantOwned.filter((name) => !byTable.has(name));
    expect(missing, `no tenant_isolation policy on: ${missing.join(', ')}`).toEqual([]);

    const wrongRole = tenantOwned.filter(
      (name) => !byTable.get(name)?.roles?.includes('app_authenticated'),
    );
    expect(
      wrongRole,
      `tenant_isolation policy not scoped TO app_authenticated on: ${wrongRole.join(', ')}`,
    ).toEqual([]);
  });
});

interface PrivilegeRow {
  table_name: string;
  privilege_type: string;
}

// RLS decides which rows; grants decide whether a role may touch the table at all. A global
// table has no policy, so its write grants are checked here.
describe('global reference tables are not writable by the request-path role', () => {
  const sql = directSql();
  let privileges: PrivilegeRow[] = [];

  // Column-level grants kept on purpose; information_schema.table_privileges does not show them.
  const ALLOWED_COLUMN_GRANTS = ['tenants.legal_name', 'rate_cards.effective_to', 'pricing_parameters.effective_to'];

  // Justified table-wide writes, spelled `table:VERB` so widening an exception still fails.
  // diesel_price_readings:INSERT: platform-admin manual entry on the request path, gated by
  // `diesel:manage`; append-only.
  const JUSTIFIED_WRITE_GRANTS = ['diesel_price_readings:INSERT'];

  beforeAll(async () => {
    privileges = await sql<PrivilegeRow[]>`
      select table_name, privilege_type
      from information_schema.table_privileges
      where table_schema = 'public'
        and grantee = 'app_authenticated'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    `;
  });

  afterAll(() => sql.end());

  it('holds no table-wide write grant on any expected global table', () => {
    // audit_logs is INSERT-only by trigger (audit-log-immutability.spec.ts).
    const writable = privileges
      .filter((p) => EXPECTED_GLOBAL_TABLES.includes(p.table_name))
      .map((p) => `${p.table_name}:${p.privilege_type}`)
      .filter((grant) => !JUSTIFIED_WRITE_GRANTS.includes(grant))
      .sort();

    expect(
      writable,
      'app_authenticated holds a table-wide write grant on a platform-global reference table. ' +
        'These have no tenant_id and therefore no RLS policy, so the grant is the ONLY control: ' +
        'one tenant could rewrite the catalogue for every tenant. REVOKE it and GRANT SELECT ' +
        'instead, as 0007 did for roles/permissions and 0016 did for the rest. ' +
        'If the grant is genuinely required, add it to JUSTIFIED_WRITE_GRANTS with the migration ' +
        'that introduced it and the app-layer control that gates it. ' +
        `Currently justified: ${JUSTIFIED_WRITE_GRANTS.join(', ') || 'none'}. ` +
        `Narrow column grants are fine and are allowlisted: ${ALLOWED_COLUMN_GRANTS.join(', ')}.`,
    ).toEqual([]);
  });

  it('cannot INSERT a tenant directly, bypassing the KYC gate in tenants_register()', async () => {
    // Through the POOLED url (app_authenticated): postgres is a superuser and bypasses both.
    const pooled = pooledSql();
    try {
      await expect(
        pooled`insert into tenants (legal_name, slug, status, kyc_state)
               values ('Self Approved Inc', 'self-approved-probe', 'active', 'verified')`,
      ).rejects.toThrow(/permission denied|denied for table/i);
    } finally {
      await pooled.end();
    }
  });

  it("cannot read another tenant's row in the tenant registry", async () => {
    const pooled = pooledSql();
    try {
      const a = await getTenantId(sql, 'test-tenant-a');
      await setTenantGuc(pooled, a);
      const rows = await pooled<Array<{ id: string }>>`select id from tenants`;
      // Exactly one row, the caller's own: a cross-tenant read here leaks the customer list.
      expect(rows.map((r) => r.id)).toEqual([a]);
    } finally {
      await pooled.end();
    }
  });
});
