import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';

// app_authenticated (NOBYPASSRLS) is created by the migration, not managed by Drizzle.
export const appAuthenticated = pgRole('app_authenticated').existing();

// RFC-1: this exact five-element form (FORCE, TO app_authenticated, USING, WITH CHECK,
// missing_ok) is mandatory for every tenant-owned table, no partial-form exception.
export function tenantIsolationPolicy() {
  return pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: appAuthenticated,
    using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    withCheck: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
  });
}
