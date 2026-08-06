import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { PERMISSION_CODES, ROLE_CODES } from '@arkilaunch/shared';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';
import { eq } from 'drizzle-orm';

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

// Seeds the global RBAC catalog (roles, permissions, role_permissions).
// Runs as service_role (migration/trusted-cron path), never on a request
// path. Idempotent: safe to re-run against an already-seeded database.
export async function seedPermissionCatalog(db: ReturnType<typeof makeServiceDb>['db']) {
  const roleIds = new Map<string, string>();
  for (const name of ROLE_CODES) {
    const [row] = await db
      .insert(schema.roles)
      .values({ name })
      .onConflictDoUpdate({ target: schema.roles.name, set: { name } })
      .returning();
    if (row) roleIds.set(name, row.id);
  }

  const permissionIds = new Map<string, string>();
  for (const code of PERMISSION_CODES) {
    const [row] = await db
      .insert(schema.permissions)
      .values({ code })
      .onConflictDoUpdate({ target: schema.permissions.code, set: { code } })
      .returning();
    if (row) permissionIds.set(code, row.id);
  }

  // platform_admin: every permission (RFC-1 §3, "a reserved role, never a
  // bypass"). admin (the tenant's own back-office admin, e.g. Rhea in the
  // PRD) manages their own tenant's users, quotes, and the EDTR
  // reconciliation approve/deduct gate (PRD-F3 US-01); KYC extraction
  // submission is admin's (they upload the corporate doc at onboarding) but
  // the human portal *verification* is platform_admin's (PRD-F6 US-06).
  // admin also manages the fleet (PRD-F4 US-04: record maintenance,
  // update equipment) and reads reports, and can book/checkout on a
  // customer's behalf (PRD-F8/F2). owner is read-mostly on OPERATIONAL data
  // (PRD §2, PRD-F4 US-10: reports only, no data-entry permission --
  // QAD-T19), plus booking:read for the same read-mostly posture -- but it
  // DOES hold user:manage + tenant:manage (Phase 2, S3 self-service signup):
  // a provisioned tenant's first user is `owner`, and QAD-T19 was never a
  // rule against an owner administering their own company's users/settings.
  // timekeeper only ever creates EDTRs on their assigned sites
  // (PRD-F3 US-02); it never approves/deducts. customer (PRD-F8/F2,
  // cr-arkilaunch-f2-f8-bookings-payments.md) can create/read their own
  // bookings and check out a deposit, and read their own quotes; it holds
  // no staff permission. billing:read and site:manage
  // (cr-arkilaunch-f9-read-surface.md) follow the same admin/owner
  // read-mostly split as report:read/fleet:manage: admin and
  // platform_admin can deploy/return equipment and manage sites; owner
  // reads invoices and the deposit ledger but never writes (QAD-T19).
  const grants: Record<string, readonly (typeof PERMISSION_CODES)[number][]> = {
    platform_admin: PERMISSION_CODES,
    admin: [
      'tenant:manage',
      'user:manage',
      'quote:create',
      'quote:read',
      'quote:approve',
      'edtr:create',
      'edtr:approve',
      'kyc:extract',
      'pricing:manage',
      'fleet:manage',
      'report:read',
      'booking:create',
      'booking:read',
      'payment:checkout',
      'billing:read',
      'site:manage',
    ],
    // owner also governs its own tenant (Phase 2, S3 self-service signup):
    // a provisioned tenant's first user is `owner`, and QAD-T19's "owner
    // cannot do data entry" is about OPERATIONAL writes (EDTR, equipment,
    // quotes) -- it was never a rule against administering one's own
    // company. Without user:manage + tenant:manage, a freshly approved
    // tenant's sole user could not invite anyone or edit tenant settings.
    owner: ['quote:read', 'report:read', 'booking:read', 'billing:read', 'user:manage', 'tenant:manage'],
    timekeeper: ['edtr:create'],
    customer: ['booking:create', 'booking:read', 'payment:checkout', 'quote:read'],
  };

  for (const [roleName, codes] of Object.entries(grants)) {
    const roleId = roleIds.get(roleName);
    if (!roleId) continue;
    const existing = await db
      .select()
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    for (const code of codes) {
      const permissionId = permissionIds.get(code);
      if (permissionId && !existing.some((r) => r.permissionId === permissionId)) {
        await db.insert(schema.rolePermissions).values({ roleId, permissionId });
      }
    }
  }

  return { roleIds, permissionIds };
}

export function makeServiceDb() {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL_DIRECT is required for seeding');
  const client = postgres(connectionString, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}
