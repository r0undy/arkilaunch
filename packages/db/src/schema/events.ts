import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

// tenant_id is nullable, but under RLS (NULL = x is NULL) app_authenticated can neither
// read nor write a NULL-tenant row.
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(), // snake_case object_action, PRD §5.6 naming convention
    properties: jsonb('properties').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('events_tenant_id_idx').on(table.tenantId),
  ],
);
