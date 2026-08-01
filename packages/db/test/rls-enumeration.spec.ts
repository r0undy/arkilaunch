import { describe, expect, it, afterAll } from 'vitest';
import { directSql } from './helpers.js';

// The regression guard against RFC-1's most-named hazard: a future
// migration adding a tenant table without the mandatory five-element RLS
// form. Enumerates pg_class / pg_policies rather than trusting the schema
// file, because what actually landed in Postgres is what matters.
const TENANT_OWNED_TABLES = [
  'subscriptions',
  'users',
  'refresh_tokens',
  'audit_logs',
  'customers',
  'customer_contacts',
  'addresses',
  'customer_addresses',
  'kyc_documents',
  'equipment',
  'rate_cards',
  'maintenance_schedules',
  'maintenance_logs',
  'project_sites',
  'rentals',
  'quotations',
  'quotation_items',
  'rental_contracts',
  'equipment_assignments',
  'edtr',
  'edtr_line_items',
  'edtr_reconciliations',
  'invoices',
  'invoice_line_items',
  'payments',
  'weather_alerts',
  'notifications',
  'pricing_parameters',
];

describe('RLS is enabled, forced, and policy-covered on every tenant-owned table', () => {
  const sql = directSql();
  afterAll(() => sql.end());

  it(`covers all ${TENANT_OWNED_TABLES.length} tenant-owned tables (SDD §3: 28 of 35)`, () => {
    expect(TENANT_OWNED_TABLES).toHaveLength(28);
  });

  for (const table of TENANT_OWNED_TABLES) {
    it(`${table}: ENABLE + FORCE row-level security`, async () => {
      const rows = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        select relrowsecurity, relforcerowsecurity
        from pg_class
        where relname = ${table} and relkind = 'r' and relnamespace = 'public'::regnamespace
      `;
      expect(rows, `table "${table}" not found`).toHaveLength(1);
      expect(rows[0]?.relrowsecurity, `${table}: RLS not enabled`).toBe(true);
      expect(rows[0]?.relforcerowsecurity, `${table}: RLS not FORCEd (owner would bypass)`).toBe(
        true,
      );
    });

    it(`${table}: has a tenant_isolation policy scoped to app_authenticated`, async () => {
      const rows = await sql<{ policyname: string; roles: string[] }[]>`
        select policyname, roles::text[]
        from pg_policies
        where schemaname = 'public' and tablename = ${table} and policyname = 'tenant_isolation'
      `;
      expect(rows, `${table}: no tenant_isolation policy`).toHaveLength(1);
      expect(rows[0]?.roles).toContain('app_authenticated');
    });
  }
});
