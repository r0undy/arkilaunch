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
import { truckRequests } from './trucks.js';

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
    // Null for the yard's own sites; scopes which sites a customer can book onto.
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

// A timekeeper may only submit or view an EDTR for a site they are assigned to.
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
    // Assigned by the booking_code_assign trigger, immutable; the sql`NULL` default only makes
    // Drizzle omit the column (the trigger refuses a supplied code).
    code: text('code').notNull().default(sql`NULL`),
    status: text('status').notNull().default('draft'),
    siteContact: text('site_contact'),
    siteContactMobile: text('site_contact_mobile'),
    siteNotes: text('site_notes'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }),
    callRequestedAt: timestamp('call_requested_at', { withTimezone: true }),
    callConfirmedAt: timestamp('call_confirmed_at', { withTimezone: true }),
    callConfirmedBy: uuid('call_confirmed_by').references(() => users.id),
    // A 'pending' request holds its dates until then; payment is the hard lock.
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('rentals_tenant_id_idx').on(table.tenantId),
    check('rentals_site_contact_mobile_chk', sql`${table.siteContactMobile} IS NULL OR ${table.siteContactMobile} ~ '^[+]639[0-9]{9}$'`),
  ],
);

// Revision chain plus frozen diesel and pricing_parameters snapshots make a quote reproducible.
// status: draft | approved | sent | superseded | rejected.
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
    mobilizationPhp: numeric('mobilization_php', { precision: 14, scale: 2 }).notNull().default('0'),
    demobilizationPhp: numeric('demobilization_php', { precision: 14, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('quotations_tenant_id_idx').on(table.tenantId),
  ],
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
    // 'equipment' or 'custom'; the quotation_items_kind_shape CHECK enforces the pairing.
    kind: text('kind').notNull().default('equipment'),
    description: text('description'),
    equipmentTypeId: uuid('equipment_type_id').references(() => equipmentTypes.id),
    rateCardId: uuid('rate_card_id').references(() => rateCards.id),
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
    operatorUserId: uuid('operator_user_id').references(() => users.id),
    selectedOptions: jsonb('selected_options').$type<Record<string, string>>().notNull().default({}),
    bookedHours: numeric('booked_hours', { precision: 10, scale: 2 }),
  },
  (table) => [tenantIsolationPolicy(),
    index('equipment_assignments_tenant_id_idx').on(table.tenantId),
    index('equipment_assignments_operator_user_id_idx').on(table.operatorUserId),
  ],
);

export const tenantCalendar = pgTable(
  'tenant_calendar',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    openTime: text('open_time').notNull().default('07:00'),
    closeTime: text('close_time').notNull().default('17:00'),
    openDays: integer('open_days').array().notNull().default(sql`'{1,2,3,4,5,6}'`),
    blackouts: jsonb('blackouts').$type<{ date: string; label?: string | undefined }[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

// Negotiation thread: a record of the haggling only; the agreed price lands as a quotation
// revision, so nothing here is ever charged.
export const negotiationMessages = pgTable(
  'negotiation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    // Exactly one of rental_id / truck_request_id (CHECK in SQL).
    rentalId: uuid('rental_id').references(() => rentals.id),
    truckRequestId: uuid('truck_request_id').references(() => truckRequests.id),
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

// A paid booking is never cancelled or moved by the customer alone: a person checks the refund.
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
    assignmentId: uuid('assignment_id').references(() => equipmentAssignments.id),
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

// Proof a customer's site is real; required before it takes a booking or truck trip.
export const siteDocuments = pgTable(
  'site_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id),
    documentType: text('document_type').notNull(), // SITE_DOCUMENT_TYPES
    fileUri: text('file_uri').notNull(), // Supabase Storage key, signed-URL access only
    status: text('status').notNull().default('pending'), // pending | verified | rejected
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    index('site_documents_tenant_id_idx').on(t.tenantId),
    index('site_documents_project_site_id_idx').on(t.projectSiteId),
  ],
);
