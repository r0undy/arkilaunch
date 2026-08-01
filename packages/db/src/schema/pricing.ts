import { date, numeric, pgTable, text, timestamp, uuid, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';

// Global, public, non-PII fuel-price cache (RFC-3). The persisted
// "last-known diesel price" so a cold worker restart still has a fallback.
// App role gets SELECT only; writes are service_role cron or a
// platform-admin route (never the tenant request path).
export const dieselPriceReadings = pgTable(
  'diesel_price_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    region: text('region').notNull().default('NCR'),
    pricePhp: numeric('price_php', { precision: 8, scale: 4 }).notNull(),
    observedDate: date('observed_date').notNull(),
    source: text('source').notNull(), // doe_scrape | platform_manual | admin_override
    sourceUrl: text('source_url'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedBy: uuid('captured_by').references(() => users.id),
  },
  (t) => [
    check('price_sane', sql`${t.pricePhp} BETWEEN 20 AND 150`),
    check('source_valid', sql`${t.source} IN ('doe_scrape','platform_manual','admin_override')`),
  ],
);

// Time-variant per-tenant pricing inputs (RFC-3). Tenant-owned; table 35 of
// 35 in the SDD §3 master catalog.
export const pricingParameters = pgTable(
  'pricing_parameters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    region: text('region').notNull().default('NCR'),
    operatorHourlyPhp: numeric('operator_hourly_php', { precision: 10, scale: 2 }).notNull(),
    maintenanceHourlyPhp: numeric('maintenance_hourly_php', {
      precision: 10,
      scale: 2,
    }).notNull(),
    bufferPct: numeric('buffer_pct', { precision: 5, scale: 4 }).notNull().default('0.10'),
    fuelLPerHour: numeric('fuel_l_per_hour', { precision: 8, scale: 3 }).notNull(),
    fuelLPerKm: numeric('fuel_l_per_km', { precision: 8, scale: 3 }).notNull(),
    transportPhpPerKm: numeric('transport_php_per_km', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    dieselOverridePhp: numeric('diesel_override_php', { precision: 8, scale: 4 }),
    dieselOverrideDate: date('diesel_override_date'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('buffer_range', sql`${t.bufferPct} BETWEEN 0 AND 1`),
  ],
);
