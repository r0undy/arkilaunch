import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';

// app_authenticated is created by the migration (RFC-1 §3: "CREATE ROLE
// app_authenticated LOGIN NOBYPASSRLS"), not managed by Drizzle.
export const appAuthenticated = pgRole('app_authenticated').existing();

// RFC-1 §3: "This exact five-element form (FORCE, TO app_authenticated,
// USING, WITH CHECK, missing_ok) is mandatory for every tenant-owned table
// added by any future RFC or migration, with no partial-form exception."
// A shared helper is how that "no exception" rule is actually enforced in
// code, rather than copy-pasted 28 times with room to drift.
export function tenantIsolationPolicy() {
  return pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: appAuthenticated,
    using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    withCheck: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
  });
}
