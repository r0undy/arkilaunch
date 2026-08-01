import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';

// --- Global tables (not tenant-scoped; SDD §3 lists 7) ---

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').notNull().default('onboarding'), // onboarding, active, suspended
  kycState: text('kyc_state').notNull().default('unverified'), // unverified, submitted, verified
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  () => [tenantIsolationPolicy()],
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
    email: text('email').notNull(), // UNIQUE (tenant_id, email); see migration
    passwordHash: text('password_hash').notNull(), // argon2id, never logged
    status: text('status').notNull().default('active'), // active, disabled, locked
    totpSecret: text('totp_secret'), // 2FA; encrypted at rest. Not enrolled by this slice.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
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
  () => [tenantIsolationPolicy()],
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
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
);
