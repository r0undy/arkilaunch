import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { RouteCity, TruckBanRuleInput, TruckExtra, TruckPrice } from '@arkilaunch/shared';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';

// Self-loading truck service (migration 0031). One settings row per tenant:
// the truck's own fees and any extra charges the admin adds. Per-km and fuel
// come from pricing_parameters, never duplicated here.
export const truckSettings = pgTable(
  'truck_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    baseFeePhp: numeric('base_fee_php', { precision: 12, scale: 2 }).notNull().default('0'),
    driverFeePhp: numeric('driver_fee_php', { precision: 12, scale: 2 }).notNull().default('0'),
    extras: jsonb('extras').$type<TruckExtra[]>().notNull().default([]),
    // 0037: null formula = the built-in default (DEFAULT_TRUCK_FORMULA).
    formula: text('formula'),
    rangePct: numeric('range_pct', { precision: 5, scale: 2 }).notNull().default('10'),
    region: text('region').notNull().default('NCR'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const truckRequests = pgTable(
  'truck_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    // 0058: TRK-YYYY-NNNN, same generator and rules as rentals.code.
    code: text('code').notNull().default(sql`NULL`),
    pickup: text('pickup').notNull(),
    dropoff: text('dropoff').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    notes: text('notes'),
    // Road distance from the routing estimate; confirmed_km is the admin's
    // figure and is the only one a price is ever charged on.
    estimatedKm: numeric('estimated_km', { precision: 8, scale: 1 }).notNull(),
    routeCities: jsonb('route_cities').$type<RouteCity[]>(),
    confirmedKm: numeric('confirmed_km', { precision: 8, scale: 1 }),
    status: text('status').notNull().default('estimated'),
    agreedPricePhp: numeric('agreed_price_php', { precision: 14, scale: 2 }),
    price: jsonb('price').$type<TruckPrice>().notNull(),
    // 0037: exact map pins (null = routed from the typed place names), the
    // cap locked at request time, and the callback before payment.
    pickupLat: numeric('pickup_lat', { precision: 9, scale: 6 }),
    pickupLng: numeric('pickup_lng', { precision: 9, scale: 6 }),
    dropoffLat: numeric('dropoff_lat', { precision: 9, scale: 6 }),
    dropoffLng: numeric('dropoff_lng', { precision: 9, scale: 6 }),
    capPhp: numeric('cap_php', { precision: 14, scale: 2 }),
    callRequestedAt: timestamp('call_requested_at', { withTimezone: true }),
    callConfirmedAt: timestamp('call_confirmed_at', { withTimezone: true }),
    callConfirmedBy: uuid('call_confirmed_by').references(() => users.id),
    // 0055: the customer's project site this trip serves, so staff can open
    // its proof documents. FK in SQL (project_sites lives in rentals.ts,
    // which imports this file). Null on requests made before 0055.
    projectSiteId: uuid('project_site_id'),
    // 0059: who drives and loads, for the site hub's personnel tab.
    driverName: text('driver_name'),
    helperName: text('helper_name'),
    // 0067: the company the trip is booked for (the site is optional), what
    // it carries, and the agreed price the customer last accepted. FK in
    // SQL, like project_site_id.
    customerId: uuid('customer_id'),
    loadDescription: text('load_description'),
    acceptedPricePhp: numeric('accepted_price_php', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('truck_requests_status_valid', sql`${t.status} IN ('estimated','km_confirmed','agreed','paid','cancelled')`),
    index('truck_requests_tenant_id_idx').on(t.tenantId),
    index('truck_requests_requested_by_idx').on(t.requestedBy),
    index('truck_requests_customer_id_idx').on(t.customerId),
    check('truck_requests_load_description_len', sql`${t.loadDescription} IS NULL OR char_length(${t.loadDescription}) BETWEEN 1 AND 300`),
  ],
);

// 0058: one counter per tenant, service and Asia/Manila year behind
// rentals.code / truck_requests.code. Written only by the insert trigger.
export const bookingCodeCounters = pgTable(
  'booking_code_counters',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    service: text('service').notNull(),
    year: integer('year').notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [
    tenantIsolationPolicy(),
    primaryKey({ name: 'booking_code_counters_pk', columns: [t.tenantId, t.service, t.year] }),
    check('booking_code_counters_service_chk', sql`${t.service} IN ('rental','truck')`),
  ],
);

// 0037: named tolls the admin picks from when confirming a trip's km.
export const tollRates = pgTable(
  'toll_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    feePhp: numeric('fee_php', { precision: 12, scale: 2 }).notNull(),
    // 0046: an expressway entry-to-exit fee (null on a free-named toll).
    expressway: text('expressway'),
    entryPoint: text('entry_point'),
    exitPoint: text('exit_point'),
    vehicleClass: integer('vehicle_class').notNull().default(3),
    asOf: date('as_of'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('toll_rates_fee_nonnegative', sql`${t.feePhp} >= 0`),
    index('toll_rates_tenant_id_idx').on(t.tenantId),
  ],
);

export const truckBanRules = pgTable(
  'truck_ban_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    city: text('city').notNull(),
    province: text('province').notNull(),
    days: integer('days').array().notNull(),
    windows: jsonb('windows').$type<TruckBanRuleInput['windows']>().notNull(),
    minGvwKg: integer('min_gvw_kg'),
    permitNote: text('permit_note').notNull().default(''),
    verified: boolean('verified').notNull().default(false),
  },
  (t) => [tenantIsolationPolicy(), index('truck_ban_rules_tenant_id_idx').on(t.tenantId),
    uniqueIndex('truck_ban_rules_tenant_city_province_key').on(t.tenantId, t.city, t.province)],
);
