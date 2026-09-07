import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

// First-party analytics sink (SDD §1 "Analytics sink resolved"; PRD §5.6).
// Every BRD-M# metric has a feeding event; this table is where they land.
// tenant_id is nullable because a small number of events (platform-level,
// e.g. a diesel-scrape failure not yet tied to a tenant) have no tenant
// context. tenantIsolationPolicy() (../rls.js) is a plain equality check
// (`tenant_id = current_setting(...)::uuid`), and NULL = anything is NULL,
// which Postgres treats as a rejection in WITH CHECK and a hidden row in
// USING -- so app_authenticated can neither write nor read a NULL-tenant
// row under RLS. The only writer today is jobs/src/diesel.ts, which
// connects as a superuser (jobs/src/db-client.ts) and bypasses RLS
// entirely; this table does not actually support platform-level events
// through the app role. Tracked as an open gap, not fixed here.
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(), // snake_case object_action, PRD §5.6 naming convention
    properties: jsonb('properties').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);
