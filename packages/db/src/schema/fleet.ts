import { index, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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
    serialNo: text('serial_no').notNull(),
    availabilityStatus: text('availability_status').notNull().default('available'),
    runtimeHours: numeric('runtime_hours', { precision: 10, scale: 2 }).notNull().default('0'),
    // The Figma add/edit spec sheet (292:1344 Basic Information + Technical
    // Specifications). All nullable: every one of these arrived after the
    // table had rows, and none of them is required to rent a machine out.
    // `model` is the equipment's name ("Caterpillar Heavy-Duty Excavator
    // 320"); modelNumber is the manufacturer's part code ("CAT-320-GH").
    modelNumber: text('model_number'),
    yearOfManufacture: integer('year_of_manufacture'),
    weightCapacityTons: numeric('weight_capacity_tons', { precision: 8, scale: 2 }),
    engineType: text('engine_type'),
    fuelType: text('fuel_type'),
    notes: text('notes'),
    // The Supabase Storage object key, never a URL -- the public URL is
    // derived at the egress boundary so the bucket can move without a
    // backfill. Nothing else in the app stores a rendered URL either.
    photoUri: text('photo_uri'),
    // Free-text category when the type is "Others" (migration 0035).
    categoryNote: text('category_note'),
    // Price book size class (migration 0054); null = priced type-wide.
    sizeClass: text('size_class'),
    // Soft retire. A machine is never deleted: edtr rows cite equipment_id as
    // the evidence an invoice was computed from (billing.ts), and
    // equipment_assignments carries its rental history. Migration 0026
    // REVOKEs DELETE so this is the only way a unit can leave the fleet.
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    // Live since migration 0002; declared here so `generate` stops
    // proposing to drop it (audit-db-tenant-isolation.md #1).
    unique('equipment_tenant_serial_uq').on(table.tenantId, table.serialNo),
  ],
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
    // 0038: a unit card overrides its type's card; null = type-wide.
    equipmentId: uuid('equipment_id').references(() => equipment.id),
    // 0054: the price book row is type x size class; null = every size.
    sizeClass: text('size_class'),
    rateType: text('rate_type').notNull(), // hourly, daily
    rateValue: numeric('rate_value', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PHP'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }), // null = open-ended
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('rate_cards_tenant_id_idx').on(table.tenantId),
  ],
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
    // "Engine oil", "Grease"... null on rows from before migration 0035.
    task: text('task'),
    hoursInterval: numeric('hours_interval', { precision: 10, scale: 2 }).notNull(),
    nextDue: numeric('next_due', { precision: 10, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('maintenance_schedules_tenant_id_idx').on(table.tenantId),
  ],
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
    // The schedule this service reset; null for a general log.
    scheduleId: uuid('schedule_id').references(() => maintenanceSchedules.id),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('maintenance_logs_tenant_id_idx').on(table.tenantId),
  ],
);

// Date ranges a unit is out for maintenance (migration 0035). Read by
// booking availability (phase 3).
export const maintenanceWindows = pgTable(
  'maintenance_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('maintenance_windows_tenant_id_idx').on(table.tenantId),
    index('maintenance_windows_equipment_id_idx').on(table.equipmentId),
  ],
);
