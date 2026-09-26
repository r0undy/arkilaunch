import { index, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

// 0056: PAGASA warnings in force for a province, recorded by staff as PAGASA
// issues them (TCWS bulletin, rainfall and thunderstorm advisories) --
// PAGASA publishes no machine-readable feed. The weather poll reads the one
// for a site's province into every machine's level until valid_until.
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
