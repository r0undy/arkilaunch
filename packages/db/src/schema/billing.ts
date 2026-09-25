import {
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
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { rentals } from './rentals.js';
import { equipment } from './fleet.js';
import { truckRequests } from './trucks.js';

// One of two independent logs per equipment-day (RFC-2). attempts/lockedAt/
// lastError back the edtr-ocr-worker claim/lock/retry loop (RFC2-01);
// edtr_status_chk pins the 6-state lifecycle so a typo can't introduce an
// unreachable/undefined status.
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
    // queued, extracting, extracted, review, reconciled, hard_failed
    attempts: integer('attempts').notNull().default(0),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
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
    // audit-db-tenant-isolation.md #4 (the UNIQUE on
    // (tenant_id, equipment_id, report_date, source)) is deliberately NOT
    // declared yet: the dev database holds 389 duplicate rows in the
    // test-tenant-a fixture, and removing them cascades into 343 line
    // items, 396 reconciliation references (11 of them approved) and 10
    // deduction line items. That cleanup is a decision, not a migration
    // side effect. Until it lands, reconcileEdtr still pairs on the first
    // arbitrary row of an unordered scan.
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
    // NULL means the source never recorded idle time -- the real Almara
    // paper form has no idle column at all. It is NOT zero: writing 0 would
    // hand the deduction gate a fabricated reading it cannot distinguish
    // from a genuinely idle machine (migration 0017).
    hoursIdle: numeric('hours_idle', { precision: 6, scale: 2 }), // >= 0 when present
    notes: text('notes'),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('edtr_hours_nonneg_chk', sql`${t.hoursActive} >= 0 AND ${t.hoursIdle} >= 0`),
    index('edtr_line_items_tenant_id_idx').on(t.tenantId),
    // Unique, not just indexed: approve() sums ALL line items for an EDTR
    // (edtr.service.ts), so requeueing an already-extracted row inserted a
    // second line item and doubled the billable hours. Requeue both sides
    // and the pair still reconciles cleanly, at 2x
    // (audit-ocr-money-path.md #7). Verified zero existing duplicates.
    unique('edtr_line_items_edtr_id_uq').on(t.edtrId),
  ],
);

// The deposit-deduction gate (RFC-2). There is no code path from this table
// to a deduction other than the approve endpoint asserting status IN
// ('matched') OR human-resolved (AGENTS.md "Never": deduct without a
// passing reconciliation or explicit human approval).
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
    // pending, matched, discrepancy, approved, rejected
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantIsolationPolicy(),
    check(
      'edtr_recon_status_chk',
      sql`${t.status} IN ('pending','matched','discrepancy','approved','rejected')`,
    ),
    // RFC-2's "two independent logs" was enforced only by the value of a
    // text column: approve() checks the status, and its counterpart lock
    // is `if (reconciliation.counterpartEdtrId)`, i.e. optional. A row at
    // status='matched' with counterpart_edtr_id=NULL -- seeded, demo,
    // backfilled or hand-written -- therefore passed the gate and inserted
    // a deposit_deduction with no second log behind it
    // (audit-ocr-money-path.md #1, already written down in
    // cr-arkilaunch-m4-money-path-gates.md:99 and still unfixed until now).
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
    // Exactly one of rental_id / truck_request_id (migration 0032 CHECK).
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
    // The deduction's tie to the reconciliation that justifies it. Until
    // now the only link was the sentence "EDTR reconciliation <uuid>
    // (sources: <uuid>, <uuid>)" in `description`, a plain text column
    // parsed back out with a regex: no referential integrity, a trail a
    // text edit could break or forge, and findEdtrEvidence returning null
    // on any format change (audit-db-tenant-isolation.md #3). Nullable
    // because most line items are not deductions.
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
    // audit-db-tenant-isolation.md #5: the money columns carried NOT NULL
    // and nothing else, so the database accepted a negative amount. The
    // non-money tables already had checks (edtr_hours_nonneg_chk,
    // buffer_range, price_sane); the money path was the one without. A
    // negative deposit_deduction also *increases* the remaining balance in
    // resolveDepositLedger.
    check(
      'invoice_line_items_nonneg_chk',
      sql`${table.quantity} >= 0 AND ${table.unitPrice} >= 0 AND ${table.amount} >= 0`,
    ),
  ],
);

// No card/account data stored (PRD-F2). provider_ref stays globally unique
// (not composite with tenant_id) for PayMongo webhook idempotency — the one
// documented exception to the composite-unique convention (RFC-1 §3).
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
    // Set only on a cash payment: the staff member who received it.
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    providerRef: text('provider_ref').unique(),
    status: text('status').notNull().default('pending'), // pending, paid, failed, refunded
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    index('payments_tenant_id_idx').on(table.tenantId),
    check('payments_amount_nonneg_chk', sql`${table.amount} >= 0`),
  ],
);

// 0038: per-tenant billing knobs. No row = the column defaults
// (getBillingSettings in deposit-ledger.ts).
export const billingSettings = pgTable(
  'billing_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    dailyHours: numeric('daily_hours', { precision: 4, scale: 2 }).notNull().default('8'),
    minDepositPhp: numeric('min_deposit_php', { precision: 12, scale: 2 }).notNull().default('5000'),
    lowBalancePct: numeric('low_balance_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    depositPct: numeric('deposit_pct', { precision: 5, scale: 2 }).notNull().default('0'), // 0041
    // 0044: the mobilization/demobilization every new quote starts with.
    mobilizationPhp: numeric('mobilization_php', { precision: 12, scale: 2 }).notNull().default('0'),
    demobilizationPhp: numeric('demobilization_php', { precision: 12, scale: 2 }).notNull().default('0'),
    // 0047: the fewest hours a customer may book, whatever the dates.
    minHours: numeric('min_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

// 0039: reconciled hours billed past the deposit balance. Unbilled until
// jobs/src/weekly-billing.ts rolls them into a 'weekly' invoice.
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
