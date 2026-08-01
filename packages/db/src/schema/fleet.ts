import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

// Global reference catalog (SDD §3), same category as diesel_price_readings.
export const equipmentTypes = pgTable('equipment_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
});

export const equipment = pgTable(
  'equipment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    equipmentTypeId: uuid('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id),
    model: text('model').notNull(),
    serialNo: text('serial_no').notNull(), // UNIQUE (tenant_id, serial_no); see migration
    availabilityStatus: text('availability_status').notNull().default('available'),
    runtimeHours: numeric('runtime_hours', { precision: 10, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const rateCards = pgTable(
  'rate_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    equipmentTypeId: uuid('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id),
    rateType: text('rate_type').notNull(), // hourly, daily
    rateValue: numeric('rate_value', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PHP'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }), // null = open-ended
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const maintenanceSchedules = pgTable(
  'maintenance_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id),
    hoursInterval: numeric('hours_interval', { precision: 10, scale: 2 }).notNull(),
    nextDue: numeric('next_due', { precision: 10, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const maintenanceLogs = pgTable(
  'maintenance_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);
