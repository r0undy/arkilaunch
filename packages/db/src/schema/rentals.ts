import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { addresses, customers } from './customers.js';
import { equipment, equipmentTypes, rateCards } from './fleet.js';
import { dieselPriceReadings, pricingParameters } from './pricing.js';

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
    // The company this site belongs to when a customer added it; null for
    // the yard's own sites. Scopes which sites a customer can book onto.
    customerId: uuid('customer_id').references(() => customers.id),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('project_sites_tenant_id_idx').on(table.tenantId),
    index('project_sites_customer_id_idx').on(table.customerId),
  ],
);

// New table (not in the SDD §3 35-table catalog; added here, Change Record
// logged per AGENTS.md §5.1). Backs PRD-F3 US-02 AC2: a timekeeper may only
// submit or view an EDTR for a site they are assigned to.
export const timekeeperSiteAssignments = pgTable(
  'timekeeper_site_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantIsolationPolicy(), unique().on(t.tenantId, t.userId, t.projectSiteId),
    index('timekeeper_site_assignments_tenant_id_idx').on(t.tenantId),
  ],
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
    // Figma 168:1982 "Logistics & Delivery": who meets the truck and how to
    // get it on site. Free text the customer types at the cart.
    siteContact: text('site_contact'),
    siteNotes: text('site_notes'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('rentals_tenant_id_idx').on(table.tenantId),
  ],
);

// RFC-3 §3: revision chain (parentQuotationId), the frozen diesel snapshot
// (dieselPriceReadingId/Date/Source), and the frozen pricing_parameters row
// (pricingParamsId) make a quote reproducible after a later price or
// rate-card change. status: draft | approved | sent | superseded | rejected.
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
    dieselPriceReadingId: uuid('diesel_price_reading_id').references(() => dieselPriceReadings.id),
    dieselPriceDate: text('diesel_price_date'), // date; observed_date of the price used
    dieselPriceSource: text('diesel_price_source'), // doe_scrape|platform_manual|admin_override|tenant_override
    pricingParamsId: uuid('pricing_params_id').references(() => pricingParameters.id),
    parentQuotationId: uuid('parent_quotation_id').references((): AnyPgColumn => quotations.id),
    discountType: text('discount_type').notNull().default('none'), // none|percent|fixed
    discountValue: numeric('discount_value', { precision: 12, scale: 2 }).notNull().default('0'),
    subtotalPhp: numeric('subtotal_php', { precision: 14, scale: 2 }),
    totalPhp: numeric('total_php', { precision: 14, scale: 2 }),
    printableUrl: text('printable_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('quotations_tenant_id_idx').on(table.tenantId),
  ],
);

// RFC-3 §3: the 8 pricing-detail columns. The RFC's expand/backfill/contract
// SQL exists to protect pre-existing rows; there are provably zero
// quotation_items rows before this migration (the quoting feature has not
// shipped yet), so the equivalent safety property is achieved directly with
// NOT NULL + DEFAULT rather than a three-phase migration over an empty
// table.
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
    estimatedHours: numeric('estimated_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    pricingInputs: jsonb('pricing_inputs').notNull().default({}), // frozen formula inputs, RFC-3 §3
    hourlyRatePhp: numeric('hourly_rate_php', { precision: 12, scale: 2 }).notNull().default('0'),
    operatingCostPhp: numeric('operating_cost_php', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    mobilizationCostPhp: numeric('mobilization_cost_php', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    demobilizationCostPhp: numeric('demobilization_cost_php', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    bufferPhp: numeric('buffer_php', { precision: 14, scale: 2 }).notNull().default('0'),
    subtotalPhp: numeric('subtotal_php', { precision: 14, scale: 2 }).notNull().default('0'),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('hours_positive', sql`${t.estimatedHours} >= 0`),
    check('km_positive', sql`${t.mobilizationKm} >= 0 AND ${t.demobilizationKm} >= 0`),
    index('quotation_items_tenant_id_idx').on(t.tenantId),
  ],
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
  (table) => [
    tenantIsolationPolicy(),
    index('rental_contracts_tenant_id_idx').on(table.tenantId),
    // audit-db-tenant-isolation.md #5: the deposit cap is what bounds a
    // deduction, so a negative one is not a rounding curiosity.
    check('rental_contracts_deposit_nonneg_chk', sql`${table.depositRequired} >= 0`),
  ],
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
  (table) => [tenantIsolationPolicy(),
    index('equipment_assignments_tenant_id_idx').on(table.tenantId),
  ],
);

// Customer journey CR (docs/cr-arkilaunch-customer-journey.md). The
// negotiation thread behind the Figma "Messenger Chat Nego" frames: plain
// messages, some carrying a price offer. It is a record of the haggling,
// not the price itself -- the agreed number still lands as a quotation
// revision priced by the engine (RFC-3), so nothing here is ever charged.
export const negotiationMessages = pgTable(
  'negotiation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rentalId: uuid('rental_id')
      .notNull()
      .references(() => rentals.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    authorRole: text('author_role').notNull(), // customer | staff
    body: text('body').notNull(),
    offerPhp: numeric('offer_php', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    index('negotiation_messages_tenant_id_idx').on(t.tenantId),
    index('negotiation_messages_rental_id_idx').on(t.rentalId),
    check('negotiation_messages_offer_nonneg_chk', sql`${t.offerPhp} IS NULL OR ${t.offerPhp} >= 0`),
  ],
);

// Figma 231:5204 Extend Rental, plus cancel-after-payment. A customer asks,
// staff resolve; a paid booking is never cancelled or moved by the customer
// alone because the refund or the new window has to be checked by a person.
export const bookingChangeRequests = pgTable(
  'booking_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rentalId: uuid('rental_id')
      .notNull()
      .references(() => rentals.id),
    kind: text('kind').notNull(), // extend | cancel
    requestedEnd: timestamp('requested_end', { withTimezone: true }),
    reason: text('reason'),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    tenantIsolationPolicy(),
    index('booking_change_requests_tenant_id_idx').on(t.tenantId),
    index('booking_change_requests_rental_id_idx').on(t.rentalId),
    check('booking_change_requests_kind_chk', sql`${t.kind} IN ('extend', 'cancel')`),
    check('booking_change_requests_status_chk', sql`${t.status} IN ('pending', 'approved', 'rejected')`),
    check('booking_change_requests_extend_end_chk', sql`${t.kind} <> 'extend' OR ${t.requestedEnd} IS NOT NULL`),
  ],
);
