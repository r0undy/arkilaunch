import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { projectSites } from './rentals.js';

export const weatherAlerts = pgTable(
  'weather_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id),
    severity: text('severity').notNull(),
    observed: jsonb('observed'),
    isStale: boolean('is_stale').notNull().default(false),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'), // active, cleared
  },
  () => [tenantIsolationPolicy()],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    notificationType: text('notification_type').notNull(),
    payload: jsonb('payload'),
    status: text('status').notNull().default('unread'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);
