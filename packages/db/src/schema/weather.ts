import { index, boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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
  (table) => [tenantIsolationPolicy(),
    index('weather_alerts_tenant_id_idx').on(table.tenantId),
  ],
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
  (table) => [tenantIsolationPolicy(),
    index('notifications_tenant_id_idx').on(table.tenantId),
  ],
);

// PAGASA warnings for a province, keyed in by staff: PAGASA publishes no machine-readable feed.
export const pagasaAdvisories = pgTable(
  'pagasa_advisories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    province: text('province').notNull(),
    tcws: integer('tcws').notNull().default(0), // 0 = no signal, 1-5
    rainfall: text('rainfall').notNull().default('none'), // none | yellow | orange | red
    thunderstorm: boolean('thunderstorm').notNull().default(false),
    note: text('note'),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('pagasa_advisories_tenant_id_idx').on(table.tenantId),
  ],
);

// One per browser a user enabled weather alerts in; a 404/410 from the endpoint deletes the row.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    unique('push_subscriptions_tenant_endpoint_uq').on(table.tenantId, table.endpoint),
    index('push_subscriptions_tenant_id_idx').on(table.tenantId),
    index('push_subscriptions_user_id_idx').on(table.userId),
  ],
);
