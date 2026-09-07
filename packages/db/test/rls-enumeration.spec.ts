import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { directSql, pooledSql, getTenantId, setTenantGuc } from './helpers.js';

// The regression guard against RFC-1's most-named hazard: a future
// migration adding a tenant table without the mandatory five-element RLS
// form. Enumerates pg_class / pg_policies rather than trusting the schema
// file, because what actually landed in Postgres is what matters.
//
// This spec used to hardcode a 28-name list and assert toHaveLength(28).
// That is exactly the wrong shape for a drift guard: the schema had grown
// to 32 tenant-owned tables (tenant_applications,
// timekeeper_site_assignments, events, testimonials were all added later
// and none were covered), and the length assertion failed closed on the
// stale number rather than catching the drift it existed to catch. A new
// table is now discovered from the catalog, so forgetting to add it here is
// no longer possible.
//
// The tenant-owned set is derived from "has a tenant_id column". Everything
// else must be named in EXPECTED_GLOBAL_TABLES below, so a table can be
// neither silently forgotten nor silently reclassified as global.
const EXPECTED_GLOBAL_TABLES = [
  'tenants',
  'subscription_plans',
  'roles',
  'permissions',
  'role_permissions',
  'equipment_types',
  // Global DOE price feed (RFC-3): one national series, written by the
  // diesel cron and readable by every tenant. Deliberately not tenant
  // -scoped; its tenant-specific sibling pricing_parameters is.
  'diesel_price_readings',
  // Drizzle's migration bookkeeping lives in its own schema, but guard the
  // name here in case a future config moves it into public.
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
    // FORCE is the half that is easy to omit: without it the table owner is
    // exempt from its own policies, which is exactly the hole a
    // migration-owned connection opens.
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

// The other half of RFC-1 §3, and the half the RLS sweep above cannot see.
// RLS decides which ROWS a role may touch; grants decide whether it may
// touch the table at all. A global reference table has no tenant_id, so it
// gets no tenant_isolation policy and every assertion above skips it --
// which is exactly how `tenants`, `equipment_types` and
// `subscription_plans` sat with table-wide INSERT/UPDATE/DELETE granted to
// the request-path role for months (0002 granted all four verbs; 0007
// narrowed only UPDATE/DELETE, and only on `tenants`). Closed by
// 0016_reference_table_grants.sql.
describe('global reference tables are not writable by the request-path role', () => {
  const sql = directSql();
  let privileges: PrivilegeRow[] = [];

  // Column-level grants deliberately kept by 0007: a tenant may rename
  // itself, and both pricing tables may be closed off by setting
  // effective_to, but neither may be inserted, deleted, or otherwise
  // rewritten. information_schema.table_privileges reports table-level
  // grants only, so these do not appear there -- they are listed here so
  // the exception is explicit rather than invisible.
  const ALLOWED_COLUMN_GRANTS = ['tenants.legal_name', 'rate_cards.effective_to', 'pricing_parameters.effective_to'];

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
    // audit_logs is intentionally INSERT-only (0002) and append-only by
    // trigger, covered by audit-log-immutability.spec.ts; it is not in the
    // global allowlist, so it is out of scope here either way.
    const writable = privileges
      .filter((p) => EXPECTED_GLOBAL_TABLES.includes(p.table_name))
      .map((p) => `${p.table_name}:${p.privilege_type}`)
      .sort();

    expect(
      writable,
      'app_authenticated holds a table-wide write grant on a platform-global reference table. ' +
        'These have no tenant_id and therefore no RLS policy, so the grant is the ONLY control: ' +
        'one tenant could rewrite the catalogue for every tenant. REVOKE it and GRANT SELECT ' +
        'instead, as 0007 did for roles/permissions and 0016 did for the rest. ' +
        `Narrow column grants are fine and are allowlisted: ${ALLOWED_COLUMN_GRANTS.join(', ')}.`,
    ).toEqual([]);
  });

  it('cannot INSERT a tenant directly, bypassing the KYC gate in tenants_register()', async () => {
    // Behavioural, not catalog-derived, and through the POOLED url because
    // that connects as app_authenticated -- postgres is a superuser and
    // would sail past both the grant and the policy.
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
      // Exactly one row, and it is the caller's own: `tenants` carries the
      // registry of every customer on the platform, so a cross-tenant read
      // here leaks the customer list itself.
      expect(rows.map((r) => r.id)).toEqual([a]);
    } finally {
      await pooled.end();
    }
  });
});
