import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';
import { addresses, customers } from './customers.js';
import { equipment, equipmentTypes, rateCards } from './fleet.js';

export const projectSites = pgTable(
  'project_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    addressId: uuid('address_id')
      .notNull()
      .references(() => addresses.id),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const rentals = pgTable(
  'rentals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id),
    status: text('status').notNull().default('draft'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    rentalId: uuid('rental_id').references(() => rentals.id),
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull().default('draft'),
    dieselPriceSnapshot: numeric('diesel_price_snapshot', { precision: 8, scale: 4 }),
    priceStale: text('price_stale').notNull().default('false'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const quotationItems = pgTable(
  'quotation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id),
    equipmentTypeId: uuid('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id),
    rateCardId: uuid('rate_card_id')
      .notNull()
      .references(() => rateCards.id),
    quantity: integer('quantity').notNull().default(1),
    mobilizationKm: numeric('mobilization_km', { precision: 8, scale: 2 }).notNull().default('0'),
    demobilizationKm: numeric('demobilization_km', { precision: 8, scale: 2 })
      .notNull()
      .default('0'),
  },
  () => [tenantIsolationPolicy()],
);

export const rentalContracts = pgTable(
  'rental_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id),
    depositRequired: numeric('deposit_required', { precision: 14, scale: 2 }).notNull(),
    termsRef: text('terms_ref'),
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const equipmentAssignments = pgTable(
  'equipment_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id),
    rentalId: uuid('rental_id')
      .notNull()
      .references(() => rentals.id),
    start: timestamp('start', { withTimezone: true }).notNull(),
    end: timestamp('end', { withTimezone: true }),
    status: text('status').notNull().default('scheduled'), // double-book guard enforced at the app layer
  },
  () => [tenantIsolationPolicy()],
);
