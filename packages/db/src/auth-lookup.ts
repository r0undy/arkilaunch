import { sql } from 'drizzle-orm';
import { db } from './client.js';

// Pre-auth lookups only (see migrations/0001_force_rls_and_roles.sql). These
// call narrow SECURITY DEFINER functions, not the RLS-protected tables
// directly -- there is no tenant context yet at login/refresh time.

export interface AuthUserRow {
  id: string;
  tenantId: string;
  roleId: string;
  roleName: string;
  passwordHash: string;
  status: string;
}

export async function findUserByEmailForAuth(email: string): Promise<AuthUserRow | undefined> {
  const rows = await db.execute<{
    id: string;
    tenant_id: string;
    role_id: string;
    role_name: string;
    password_hash: string;
    status: string;
  }>(sql`select * from auth_find_user_by_email(${email})`);
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    roleName: row.role_name,
    passwordHash: row.password_hash,
    status: row.status,
  };
}

export interface AuthRefreshTokenRow {
  id: string;
  tenantId: string;
  userId: string;
  familyId: string;
  status: string;
  expiresAt: Date;
}

export async function findRefreshTokenByHashForAuth(
  tokenHash: string,
): Promise<AuthRefreshTokenRow | undefined> {
  const rows = await db.execute<{
    id: string;
    tenant_id: string;
    user_id: string;
    family_id: string;
    status: string;
    expires_at: string;
  }>(sql`select * from auth_find_refresh_token(${tokenHash})`);
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    familyId: row.family_id,
    status: row.status,
    expiresAt: new Date(row.expires_at),
  };
}
