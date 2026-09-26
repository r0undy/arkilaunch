import { check, index, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

// PAGASA warnings in force for a province (migration 0056), entered by
// staff from the bulletin. Append-only: cleared, never edited.
export const pagasaAdvisories = pgTable(
  'pagasa_advisories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    province: text('province').notNull(),
    tcws: integer('tcws').notNull().default(0),
    rainfallWarning: text('rainfall_warning').notNull().default('none'),
    thunderstorm: boolean('thunderstorm').notNull().default(false),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => [
    tenantIsolationPolicy(),
    index('pagasa_advisories_tenant_id_idx').on(t.tenantId),
    check('pagasa_advisories_tcws_chk', sql`${t.tcws} BETWEEN 0 AND 5`),
    check('pagasa_advisories_rain_chk', sql`${t.rainfallWarning} IN ('none','yellow','orange','red')`),
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
