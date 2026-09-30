import { index, jsonb, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appAuthenticated, tenantIsolationPolicy } from '../rls.js';

// tenants is global, so it carries `tenant_self` (keyed on id). Declared here or
// drizzle-kit generate emits DROP POLICY and re-opens the whole tenant registry.
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: text('legal_name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status').notNull().default('onboarding'), // onboarding, active, suspended
    kycState: text('kyc_state').notNull().default('unverified'), // unverified, submitted, verified
    // Written only through tenants_update_branding / tenants_set_branding_image (SECURITY DEFINER).
    logoKey: text('logo_key'),
    heroKey: text('hero_key'),
    iconKey: text('icon_key'),
    loginKey: text('login_key'),
    primaryColor: text('primary_color'), // #rrggbb, CHECK in 0051
    headerColor: text('header_color'), // #rrggbb, CHECK in 0060
    font: text('font'), // 'inter', 'plex' or NULL (Inter), CHECK in 0061
    facebookUrl: text('facebook_url'), // https Facebook page, CHECK in 0060
    messengerUrl: text('messenger_url'), // https m.me / Messenger link, CHECK in 0067
    tagline: text('tagline'),
    about: text('about'),
    phone: text('phone'),
    contactEmail: text('contact_email'),
    address: text('address'),
    city: text('city'),
    province: text('province'),
    // NULL = cash only. Written only through tenants_set_paymongo_account.
    paymongoAccountId: text('paymongo_account_id'),
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
    totpSecret: text('totp_secret'), // 2FA; encrypted at rest
    // Written only by a staff KYC approval, never by the customer.
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    // avatarKey is a private-bucket object key, never a public URL.
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
    // Declared so drizzle-kit generate stops proposing to drop it.
    unique('users_tenant_email_uq').on(table.tenantId, table.email),
    index('users_email_idx').on(table.email),
    uniqueIndex('users_email_key_uq').on(sql`email_key(${table.email})`),
  ],
);

// Tenant + owner rows come from the tenants_register() SECURITY DEFINER function: no JWT, no tenant context.
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

// Token-family lineage backing refresh rotation + reuse detection (RFC-1).
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

// Append-only: INSERT + SELECT only for app_authenticated.
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
    reason: text('reason'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('audit_logs_tenant_id_idx').on(table.tenantId),
  ],
);
