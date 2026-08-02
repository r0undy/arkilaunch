import { check, integer, jsonb, numeric, pgTable, text, timestamp, uuid, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { rentals } from './rentals.js';
import { equipment } from './fleet.js';

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
    hoursIdle: numeric('hours_idle', { precision: 6, scale: 2 }).notNull(), // >= 0
    notes: text('notes'),
  },
  (t) => [
    tenantIsolationPolicy(),
    check('edtr_hours_nonneg_chk', sql`${t.hoursActive} >= 0 AND ${t.hoursIdle} >= 0`),
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
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rentalId: uuid('rental_id')
      .notNull()
      .references(() => rentals.id),
    invoiceType: text('invoice_type').notNull(), // deposit_deduction, weekly, final
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('draft'), // draft, issued, paid, void
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
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
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  },
  () => [tenantIsolationPolicy()],
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
    method: text('method').notNull(), // card, gcash, maya, bank (channel only)
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    providerRef: text('provider_ref').unique(),
    status: text('status').notNull().default('pending'), // pending, paid, failed, refunded
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);
