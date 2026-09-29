import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { rentals } from './rentals.js';
import { equipment } from './fleet.js';
import { truckRequests } from './trucks.js';
import { customers } from './customers.js';

// One of two independent logs per equipment-day (RFC-2).
export const edtr = pgTable(
  'edtr',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rentalId: uuid('rental_id')
      .notNull()
      .references(() => rentals.id),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id),
    source: text('source').notNull(), // digital_entry | paper_ocr
    reportDate: date('report_date').notNull(),
    rawFileUri: text('raw_file_uri'), // null for direct digital entry
    ocrPayload: jsonb('ocr_payload'),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    submittedBy: uuid('submitted_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check(
      'edtr_status_chk',
      sql`${t.status} IN ('queued','extracting','extracted','review','reconciled','hard_failed')`,
    ),
    index('edtr_tenant_equipment_date_idx').on(t.tenantId, t.equipmentId, t.reportDate),
    index('edtr_status_locked_at_idx').on(t.status, t.lockedAt),
    // No UNIQUE (tenant_id, equipment_id, report_date, source) yet: dev data holds duplicates,
    // so reconcileEdtr still pairs on an arbitrary row.
  ],
);

export const edtrLineItems = pgTable(
  'edtr_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    edtrId: uuid('edtr_id')
      .notNull()
      .references(() => edtr.id),
    hoursActive: numeric('hours_active', { precision: 6, scale: 2 }).notNull(), // >= 0
    // NULL = not recorded, never 0: a 0 would hand the deduction gate a fabricated reading.
    hoursIdle: numeric('hours_idle', { precision: 6, scale: 2 }), // >= 0 when present
    notes: text('notes'),
    // Same NULL-vs-0 rule as hours_idle; classifyHours() is the only reader.
    hoursTotal: numeric('hours_total', { precision: 6, scale: 2 }),
    hoursBreakdown: numeric('hours_breakdown', { precision: 6, scale: 2 }),
    hoursWeather: numeric('hours_weather', { precision: 6, scale: 2 }),
    hoursOtherDowntime: numeric('hours_other_downtime', { precision: 6, scale: 2 }),
    downtimeNote: text('downtime_note'),
    hourMeterStart: numeric('hour_meter_start', { precision: 10, scale: 1 }),
    hourMeterEnd: numeric('hour_meter_end', { precision: 10, scale: 1 }),
    reviewFlags: jsonb('review_flags').$type<string[]>().notNull().default([]),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('edtr_hours_nonneg_chk', sql`${t.hoursActive} >= 0 AND ${t.hoursIdle} >= 0`),
    check(
      'edtr_hour_categories_nonneg_chk',
      sql`${t.hoursTotal} >= 0 AND ${t.hoursBreakdown} >= 0 AND ${t.hoursWeather} >= 0 AND ${t.hoursOtherDowntime} >= 0 AND ${t.hourMeterStart} >= 0 AND ${t.hourMeterEnd} >= 0 AND ${t.hoursTotal} <= 24 AND ${t.hoursBreakdown} <= 24 AND ${t.hoursWeather} <= 24 AND ${t.hoursOtherDowntime} <= 24`,
    ),
    index('edtr_line_items_tenant_id_idx').on(t.tenantId),
    // Unique: approve() sums every line item of an EDTR, so a second row doubles billable hours.
    unique('edtr_line_items_edtr_id_uq').on(t.edtrId),
  ],
);

// RFC-2 deduction gate: only approve() on a matched or human-resolved row may deduct.
export const edtrReconciliations = pgTable(
  'edtr_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    edtrId: uuid('edtr_id')
      .notNull()
      .unique()
      .references(() => edtr.id),
    counterpartEdtrId: uuid('counterpart_edtr_id').references(() => edtr.id),
    deltaHours: numeric('delta_hours', { precision: 6, scale: 2 }),
    tolerance: numeric('tolerance', { precision: 6, scale: 2 }).notNull(),
    verifiedBy: uuid('verified_by').references(() => users.id),
    adjustments: jsonb('adjustments'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check(
      'edtr_recon_status_chk',
      sql`${t.status} IN ('pending','matched','discrepancy','approved','rejected')`,
    ),
    // RFC-2 "two independent logs": a matched/approved row must name its counterpart.
    check(
      'edtr_recon_matched_needs_counterpart_chk',
      sql`${t.status} NOT IN ('matched','approved') OR ${t.counterpartEdtrId} IS NOT NULL`,
    ),
    index('edtr_reconciliations_tenant_id_idx').on(t.tenantId),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    // Exactly one of rental_id / truck_request_id (CHECK in SQL).
    rentalId: uuid('rental_id').references(() => rentals.id),
    truckRequestId: uuid('truck_request_id').references(() => truckRequests.id),
    invoiceType: text('invoice_type').notNull(), // deposit_deduction, weekly, final, booking, truck
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('draft'), // draft, issued, paid, void
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('invoices_tenant_id_idx').on(table.tenantId),
    index('invoices_rental_id_type_idx').on(table.rentalId, table.invoiceType),
    check('invoices_amount_nonneg_chk', sql`${table.amount} >= 0`),
  ],
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    reconciliationId: uuid('reconciliation_id').references(() => edtrReconciliations.id),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('invoice_line_items_tenant_id_idx').on(table.tenantId),
    index('invoice_line_items_reconciliation_id_idx').on(table.reconciliationId),
    check(
      'invoice_line_items_nonneg_chk',
      sql`${table.quantity} >= 0 AND ${table.unitPrice} >= 0 AND ${table.amount} >= 0`,
    ),
  ],
);

// No card/account data stored. provider_ref is globally unique (not per tenant) for
// PayMongo webhook idempotency.
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    method: text('method').notNull(), // card, gcash, maya, bank (channel only), cash
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    providerRef: text('provider_ref').unique(),
    providerPaymentId: text('provider_payment_id'),
    status: text('status').notNull().default('pending'), // pending, paid, failed, refunded
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('payments_tenant_id_idx').on(table.tenantId),
    uniqueIndex('payments_provider_payment_id_key').on(table.providerPaymentId),
    check('payments_amount_nonneg_chk', sql`${table.amount} >= 0`),
  ],
);

export const billingSettings = pgTable(
  'billing_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    dailyHours: numeric('daily_hours', { precision: 4, scale: 2 }).notNull().default('8'),
    minDepositPhp: numeric('min_deposit_php', { precision: 12, scale: 2 }).notNull().default('5000'),
    lowBalancePct: numeric('low_balance_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    depositPct: numeric('deposit_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    mobilizationPhp: numeric('mobilization_php', { precision: 12, scale: 2 }).notNull().default('0'),
    demobilizationPhp: numeric('demobilization_php', { precision: 12, scale: 2 }).notNull().default('0'),
    minHours: numeric('min_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    holdHours: integer('hold_hours').notNull().default(48),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const depositAccruals = pgTable(
  'deposit_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rentalId: uuid('rental_id')
      .notNull()
      .references(() => rentals.id),
    reconciliationId: uuid('reconciliation_id')
      .notNull()
      .unique('deposit_accruals_reconciliation_unique')
      .references(() => edtrReconciliations.id),
    hours: numeric('hours', { precision: 10, scale: 2 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('deposit_accruals_tenant_id_idx').on(table.tenantId),
    check('deposit_accruals_amount_positive', sql`${table.amount} > 0`),
  ],
);

// redeemed_count is bumped by one guarded UPDATE at checkout, never read-then-written.
export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    discountType: text('discount_type').notNull(), // percent, fixed
    discountValue: numeric('discount_value', { precision: 14, scale: 2 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    oncePerCustomer: boolean('once_per_customer').notNull().default(false),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('coupons_tenant_id_idx').on(table.tenantId),
    unique('coupons_tenant_code_unique').on(table.tenantId, table.code),
    check('coupons_code_chk', sql`${table.code} ~ '^[A-Z0-9_-]{3,32}$'`),
    check(
      'coupons_discount_chk',
      sql`${table.discountType} IN ('percent', 'fixed') AND ${table.discountValue} > 0 AND (${table.discountType} <> 'percent' OR ${table.discountValue} <= 100)`,
    ),
    check('coupons_max_uses_chk', sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`),
    check('coupons_redeemed_chk', sql`${table.redeemedCount} >= 0`),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .unique('coupon_redemptions_invoice_unique')
      .references(() => invoices.id),
    discountPhp: numeric('discount_php', { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('coupon_redemptions_tenant_id_idx').on(table.tenantId),
    index('coupon_redemptions_coupon_customer_idx').on(table.couponId, table.customerId),
    check('coupon_redemptions_discount_positive', sql`${table.discountPhp} > 0`),
  ],
);
