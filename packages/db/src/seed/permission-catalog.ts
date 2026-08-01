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
  // PRD) manages their own tenant's users and quotes. owner is read-mostly
  // oversight (PRD §2). timekeeper has none of these yet -- it gets EDTR
  // capture permissions with F3.
  const grants: Record<string, readonly (typeof PERMISSION_CODES)[number][]> = {
    platform_admin: PERMISSION_CODES,
    admin: ['tenant:manage', 'user:manage', 'quote:create', 'quote:read'],
    owner: ['quote:read'],
    timekeeper: [],
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
