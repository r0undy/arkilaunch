import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { TruckExtra, TruckPrice } from '@arkilaunch/shared';
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
    pickup: text('pickup').notNull(),
    dropoff: text('dropoff').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    notes: text('notes'),
    // Road distance from the routing estimate; confirmed_km is the admin's
    // figure and is the only one a price is ever charged on.
    estimatedKm: numeric('estimated_km', { precision: 8, scale: 1 }).notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('truck_requests_status_valid', sql`${t.status} IN ('estimated','km_confirmed','agreed','paid','cancelled')`),
    index('truck_requests_tenant_id_idx').on(t.tenantId),
    index('truck_requests_requested_by_idx').on(t.requestedBy),
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
