import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { directSql } from './helpers.js';

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
