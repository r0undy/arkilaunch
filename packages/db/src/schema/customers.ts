import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id), // optional; internal-only records
    companyName: text('company_name').notNull(),
    kycStatus: text('kyc_status').notNull().default('pending'), // pending, approved, rejected
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    contactType: text('contact_type').notNull(), // phone, email
    contactValue: text('contact_value').notNull(),
    isPrimary: text('is_primary').notNull().default('false'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    province: text('province').notNull(),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('PH'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    addressId: uuid('address_id')
      .notNull()
      .references(() => addresses.id),
    addressType: text('address_type').notNull(), // billing, site
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);

// Sensitive personal info under RA 10173 (CLR register). Real Azure DI
// extraction lands with RFC-2; the ocr_payload/confidence columns are
// reserved here so the table shape does not change when F6 lands.
export const kycDocuments = pgTable(
  'kyc_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    documentType: text('document_type').notNull(), // SEC cert, BIR form, etc.
    fileUri: text('file_uri').notNull(), // Supabase Storage pointer, signed-URL access only
    ocrPayload: jsonb('ocr_payload'),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    status: text('status').notNull().default('pending'), // pending, needs_review, verified, rejected
    // RFC-2 §2: worker claim/lock/retry bookkeeping, same shape as edtr.
    attempts: integer('attempts').notNull().default(0),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    // RFC-2 §3: format check + fuzzy-match + human portal confirmation.
    formatValid: jsonb('format_valid'), // { sec_number: bool, tin: bool }
    portalMatchScore: numeric('portal_match_score', { precision: 5, scale: 4 }),
    registryStatus: text('registry_status'), // active | suspended | revoked, human-confirmed
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);
