import { index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

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
    // All nullable: added after the table had rows. `model` is the name; modelNumber the part code.
    modelNumber: text('model_number'),
    yearOfManufacture: integer('year_of_manufacture'),
    weightCapacityTons: numeric('weight_capacity_tons', { precision: 8, scale: 2 }),
    engineType: text('engine_type'),
    fuelType: text('fuel_type'),
    notes: text('notes'),
    // Storage object key, never a URL: the public URL is derived at egress.
    photoUri: text('photo_uri'),
    categoryNote: text('category_note'),
    // Labels only; never priced.
    optionGroups: jsonb('option_groups').$type<{ name: string; values: string[] }[]>().notNull().default([]),
    photoCredit: text('photo_credit'),
    photoSourceUrl: text('photo_source_url'),
    // Soft retire only: edtr rows cite equipment_id as invoice evidence, and DELETE is REVOKEd.
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    // Declared so drizzle-kit generate stops proposing to drop it.
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
    // A unit card overrides its type's card; null = type-wide.
    equipmentId: uuid('equipment_id').references(() => equipment.id),
    rateType: text('rate_type').notNull(), // hourly only (0071); older non-hourly rows are retired
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
    scheduleId: uuid('schedule_id').references(() => maintenanceSchedules.id),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('maintenance_logs_tenant_id_idx').on(table.tenantId),
  ],
);

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
