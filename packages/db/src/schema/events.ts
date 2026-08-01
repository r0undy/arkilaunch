import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

// First-party analytics sink (SDD §1 "Analytics sink resolved"; PRD §5.6).
// Every BRD-M# metric has a feeding event; this table is where they land.
// tenant_id is nullable because a small number of events (platform-level,
// e.g. a diesel-scrape failure not yet tied to a tenant) have no tenant
// context; the tenant_isolation policy only constrains rows where it is
// set, matching the RLS pattern used elsewhere for nullable tenant_id.
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
