import { index, jsonb, pgPolicy, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appAuthenticated, tenantIsolationPolicy } from '../rls.js';

// --- Global tables (not tenant-scoped; SDD §3 lists 7) ---

// `tenants` is global rather than tenant-owned, so it carries
// `tenant_self` (keyed on id) instead of the shared tenantIsolationPolicy
// (keyed on tenant_id). The policy and its FORCE RLS have been live since
// migration 0016, but were never expressed here -- and the drizzle-kit
// snapshot is what `generate` diffs against, so the next generate would
// have emitted DROP POLICY "tenant_self" ON tenants and re-opened
// cross-tenant read of the whole tenant registry
// (audit-db-tenant-isolation.md #1). Declared here so schema, snapshot
// and database agree.
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: text('legal_name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status').notNull().default('onboarding'), // onboarding, active, suspended
    kycState: text('kyc_state').notNull().default('unverified'), // unverified, submitted, verified
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('tenant_self', {
      as: 'permissive',
      for: 'all',
      to: appAuthenticated,
      using: sql`id = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS();

export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  limits: jsonb('limits').notNull().default({}),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  description: text('description'),
});

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id),
  permissionId: uuid('permission_id')
    .notNull()
    .references(() => permissions.id),
});

// --- Tenant-owned identity/RBAC/audit tables ---

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id),
    status: text('status').notNull().default('trialing'), // trialing, active, past_due, canceled
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('subscriptions_tenant_id_idx').on(table.tenantId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(), // argon2id, never logged
    status: text('status').notNull().default('active'), // active, disabled, locked
    totpSecret: text('totp_secret'), // 2FA; encrypted at rest. Not enrolled by this slice.
    // Legal name read off a customer's National ID (KYC), written only by a
    // staff decide() approval -- never set directly by the customer.
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    // Self-service profile (migration 0030). avatarKey is an object key in the
    // private KYC bucket, never a public URL.
    phone: text('phone'),
    address: text('address'),
    avatarKey: text('avatar_key'),
    notificationPrefs: jsonb('notification_prefs')
      .$type<{ email: boolean; sms: boolean; inApp: boolean }>()
      .notNull()
      .default({ email: true, sms: false, inApp: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolationPolicy(),
    // Live since migration 0002; declared here so `generate` stops
    // proposing to drop it (audit-db-tenant-isolation.md #1).
    unique('users_tenant_email_uq').on(table.tenantId, table.email),
    index('users_email_idx').on(table.email),
  ],
);

// POST /tenants/register (backend-unblock plan workstream 1). Holds the
// company-facing details a self-registered tenant submits; the tenant +
// owner user rows themselves are created directly by the
// tenants_register() SECURITY DEFINER function (see
// migrations/0008_tenant_registration.sql), not by app code through
// withTenantTx -- there is no JWT, so no tenant context, at registration
// time.
export const tenantApplications = pgTable(
  'tenant_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    companyName: text('company_name').notNull(),
    businessAddress: text('business_address').notNull(),
    secNumber: text('sec_number').notNull(),
    tin: text('tin').notNull(),
    contactFirstName: text('contact_first_name').notNull(),
    contactLastName: text('contact_last_name').notNull(),
    contactMobile: text('contact_mobile').notNull(),
    contactJobTitle: text('contact_job_title').notNull(),
    status: text('status').notNull().default('pending'), // pending, approved, rejected
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('tenant_applications_tenant_id_idx').on(table.tenantId),
  ],
);

// RFC-1 §3: token-family lineage backing rotation + reuse detection.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(), // sha-256; raw token never stored
    parentId: uuid('parent_id'),
    status: text('status').notNull().default('active'), // active, rotated, revoked
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'), // INET in the migration; text here to avoid a custom Drizzle type
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('refresh_tokens_tenant_id_idx').on(table.tenantId),
  ],
);

// Append-only: INSERT + SELECT only for app_authenticated (UPDATE/DELETE
// revoked in the migration). SDD §3: "lets an invoice cite the exact
// reconciliation ... behind a deduction."
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(), // CREATE, UPDATE, DELETE, APPROVE, DEDUCT
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    // Why, for actions that must carry one (runtime correction, 0035).
    reason: text('reason'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('audit_logs_tenant_id_idx').on(table.tenantId),
  ],
);
