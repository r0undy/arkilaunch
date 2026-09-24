import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
    // Figma 582:3946 "Add New Company". One login may own several companies
    // (several rows sharing user_id).
    tin: text('tin'),
    // SEC/DTI registration number, shown as "Registration Number" on the
    // company card (Figma 251:1945). Nullable: companies registered before
    // this column existed have none, and the OCR scan only suggests it.
    secNumber: text('sec_number'),
    billingAddress: text('billing_address'),
    kycStatus: text('kyc_status').notNull().default('pending'), // pending, approved, rejected
    // A reviewer's note to the customer on a pending company, and the fields
    // and document types it unlocks for them to fix. Everything else stays
    // read-only while the company waits for review.
    reviewComment: text('review_comment'),
    unlockedFields: jsonb('unlocked_fields').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('customers_tenant_id_idx').on(table.tenantId),
  ],
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
  (table) => [tenantIsolationPolicy(),
    index('customer_contacts_tenant_id_idx').on(table.tenantId),
  ],
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
  (table) => [tenantIsolationPolicy(),
    index('addresses_tenant_id_idx').on(table.tenantId),
  ],
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
  (table) => [tenantIsolationPolicy(),
    index('customer_addresses_tenant_id_idx').on(table.tenantId),
  ],
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
    documentType: text('document_type').notNull(), // company_registration (SEC/DTI), government_id (Philippine National ID / PhilSys only)
    fileUri: text('file_uri').notNull(), // Supabase Storage pointer, signed-URL access only
    ocrPayload: jsonb('ocr_payload'),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    status: text('status').notNull().default('pending'), // pending, needs_review, verified, rejected, superseded (replaced by a re-upload); legacy resubmit_required reads as pending
    // RFC-2 §2: worker claim/lock/retry bookkeeping, same shape as edtr.
    attempts: integer('attempts').notNull().default(0),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    // RFC-2 §3: format check + fuzzy-match + human portal confirmation.
    formatValid: jsonb('format_valid'), // { tin, sec_number, dti_number, id_number: bool }
    portalMatchScore: numeric('portal_match_score', { precision: 5, scale: 4 }),
    registryStatus: text('registry_status'), // active | suspended | revoked, human-confirmed
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('kyc_documents_tenant_id_idx').on(table.tenantId),
  ],
);
