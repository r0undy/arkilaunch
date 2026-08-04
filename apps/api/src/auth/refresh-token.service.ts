import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  refreshTokens,
  auditLogs,
  users,
  roles,
  withTenantTx,
  findRefreshTokenByHashForAuth,
} from '@arkilaunch/db';
import { eq } from 'drizzle-orm';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BOOTSTRAP_ROLE = 'system'; // GUC placeholder; RLS filters on tenant_id only, role is informational

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface IssuedRefreshToken {
  token: string; // raw, returned to the client once; only the hash is persisted
  familyId: string;
}

interface RotateResult {
  tenantId: string;
  userId: string;
  role: string;
  issued: IssuedRefreshToken;
}

// RFC-1 §3: rotating refresh tokens, family lineage, reuse detection. A
// token replayed after rotation revokes the entire family and writes a
// refresh_reuse_detected audit row (QAD abuse gate). Every write here runs
// through withTenantTx (normal RLS path) once the tenant is known; only the
// initial lookup-by-hash uses the SECURITY DEFINER function in
// packages/db/src/auth-lookup.ts, because that lookup has no tenant
// context yet by definition.
@Injectable()
export class RefreshTokenService {
  async issue(
    tenantId: string,
    userId: string,
    role: string,
    familyId?: string,
  ): Promise<IssuedRefreshToken> {
    const raw = randomBytes(32).toString('hex');
    const resolvedFamilyId = familyId ?? randomUUID();
    await withTenantTx({ tenantId, userId, role }, (tx) =>
      tx.insert(refreshTokens).values({
        tenantId,
        userId,
        familyId: resolvedFamilyId,
        tokenHash: hashToken(raw),
        status: 'active',
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      }),
    );
    return { token: raw, familyId: resolvedFamilyId };
  }

  async rotate(rawToken: string): Promise<RotateResult> {
    const tokenHash = hashToken(rawToken);
    const existing = await findRefreshTokenByHashForAuth(tokenHash);

    if (!existing) {
      throw new UnauthorizedException('invalid_refresh_token');
    }

    // Re-read the user's current role rather than trusting anything about
    // the old session: a role change or deactivation between refreshes
    // takes effect immediately.
    const current = await this.resolveCurrentUser(existing.tenantId, existing.userId);
    const ctx = { tenantId: existing.tenantId, userId: existing.userId, role: current.role };

    if (current.status !== 'active') {
      // Without this check a deactivated user could keep rotating a refresh
      // token for up to REFRESH_TOKEN_TTL_MS (30 days); deactivation would
      // be cosmetic. Revoke the family too, so this refresh token cannot be
      // replayed once the user is later reactivated.
      await this.revokeFamily(ctx, existing.familyId);
      throw new UnauthorizedException('user_inactive');
    }

    if (existing.status !== 'active') {
      await this.revokeFamily(ctx, existing.familyId);
      await withTenantTx(ctx, (tx) =>
        tx.insert(auditLogs).values({
          tenantId: existing.tenantId,
          actorId: existing.userId,
          action: 'refresh_reuse_detected',
          entity: 'refresh_tokens',
          entityId: existing.id,
        }),
      );
      throw new UnauthorizedException('refresh_reuse_detected');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('refresh_token_expired');
    }

    await withTenantTx(ctx, (tx) =>
      tx
        .update(refreshTokens)
        .set({ status: 'rotated', rotatedAt: new Date() })
        .where(eq(refreshTokens.id, existing.id)),
    );

    const issued = await this.issue(ctx.tenantId, ctx.userId, ctx.role, existing.familyId);
    await withTenantTx(ctx, (tx) =>
      tx
        .update(refreshTokens)
        .set({ parentId: existing.id })
        .where(eq(refreshTokens.tokenHash, hashToken(issued.token))),
    );

    return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, issued };
  }

  private async resolveCurrentUser(
    tenantId: string,
    userId: string,
  ): Promise<{ role: string; status: string }> {
    const rows = await withTenantTx(
      { tenantId, userId, role: BOOTSTRAP_ROLE },
      (tx) =>
        tx
          .select({ name: roles.name, status: users.status })
          .from(users)
          .innerJoin(roles, eq(roles.id, users.roleId))
          .where(eq(users.id, userId)),
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('invalid_refresh_token');
    return { role: row.name, status: row.status };
  }

  private async revokeFamily(
    ctx: { tenantId: string; userId: string; role: string },
    familyId: string,
  ): Promise<void> {
    await withTenantTx(ctx, (tx) =>
      tx
        .update(refreshTokens)
        .set({ status: 'revoked' })
        .where(eq(refreshTokens.familyId, familyId)),
    );
  }

  // Reusable by any admin action that must take effect immediately rather
  // than waiting out the access-token TTL: a role change or deactivation
  // (S19) revokes every outstanding refresh-token family for the target
  // user, in the caller's own tenant-scoped transaction.
  async revokeAllForUser(
    ctx: { tenantId: string; userId: string; role: string },
    targetUserId: string,
  ): Promise<void> {
    await withTenantTx(ctx, (tx) =>
      tx
        .update(refreshTokens)
        .set({ status: 'revoked' })
        .where(eq(refreshTokens.userId, targetUserId)),
    );
  }
}
