import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  type Tx,
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  tenants,
  timekeeperSiteAssignments,
  users,
  withTenantTx,
  pgError,
  getTenantTin,
} from '@arkilaunch/db';
import {
  evaluateUserAdminAction,
  ROLE_ASSIGNABLE_BY,
  type RequestContext,
  type RoleCode,
  type SiteAssignmentSetRequest,
  type UserInviteRequest,
  type UserListQuery,
  type UserRoleChangeRequest,
  type UserPasswordChange,
  type UserSelfResponse,
  type UserSelfUpdate,
} from '@arkilaunch/shared';
import { AuthService } from '../auth/auth.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { EventsService } from '../events/events.service.js';
import { StorageService, kycBucket } from '../storage/storage.service.js';
import { countRows } from '../common/count-rows.js';

type Ctx = RequestContext;

@Injectable()
export class UsersService {
  constructor(
    private readonly auth: AuthService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly events: EventsService,
    private readonly storage: StorageService,
  ) {}

  async list(ctx: Ctx, query: UserListQuery) {
    return withTenantTx(ctx, async (tx) => {
      const conditions = [];
      if (query.status) conditions.push(eq(users.status, query.status));
      if (query.role) {
        const [roleRow] = await tx.select().from(roles).where(eq(roles.name, query.role)).limit(1);
        conditions.push(roleRow ? eq(users.roleId, roleRow.id) : sql`false`);
      }

      const rows = await tx
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          roleId: users.roleId,
          roleName: roles.name,
          createdAt: users.createdAt,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(query.limit)
        .offset(query.offset);

      const total = await countRows(tx, users, conditions.length > 0 ? and(...conditions) : undefined);
      return { items: rows, total };
    });
  }

  // Self-scoped by ctx.userId from the verified JWT, never a param.
  async me(ctx: Ctx): Promise<UserSelfResponse> {
    const row = await withTenantTx(ctx, async (tx) => {
      const [found] = await tx
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          roleName: roles.name,
          createdAt: users.createdAt,
          firstName: users.firstName,
          middleName: users.middleName,
          lastName: users.lastName,
          phone: users.phone,
          address: users.address,
          avatarKey: users.avatarKey,
          notificationPrefs: users.notificationPrefs,
          tenantName: tenants.legalName,
          tenantSlug: tenants.slug,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .leftJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, ctx.userId))
        .limit(1);
      if (!found) throw new NotFoundException({ error: 'user_not_found' });
      return found;
    });
    // Signed outside the transaction (a Storage network call); an outage costs the picture, not the profile.
    const tenantTin = await getTenantTin(ctx.tenantId).catch(() => null);
    const avatarUrl = row.avatarKey
      ? await this.storage.createSignedDownloadUrl(kycBucket(), row.avatarKey).catch(() => null)
      : null;
    return {
      id: row.id,
      email: row.email,
      role: row.roleName,
      status: row.status as UserSelfResponse['status'],
      createdAt: row.createdAt,
      tenantName: row.tenantName ?? '',
      tenantSlug: row.tenantSlug ?? '',
      tenantTin,
      firstName: row.firstName,
      middleName: row.middleName,
      lastName: row.lastName,
      phone: row.phone,
      address: row.address,
      avatarUrl,
      notificationPrefs: row.notificationPrefs,
    };
  }

  // Own row only; the strict schema keeps email, role and the KYC-owned names out.
  async updateSelf(ctx: Ctx, body: UserSelfUpdate): Promise<UserSelfResponse> {
    if (Object.keys(body).length > 0) {
      await withTenantTx(ctx, (tx) => tx.update(users).set(body).where(eq(users.id, ctx.userId)));
    }
    return this.me(ctx);
  }

  async setAvatar(ctx: Ctx, key: string): Promise<UserSelfResponse> {
    await withTenantTx(ctx, (tx) =>
      tx.update(users).set({ avatarKey: key }).where(eq(users.id, ctx.userId)),
    );
    return this.me(ctx);
  }

  // Revokes every refresh-token family so other signed-in devices are logged out.
  async changePassword(ctx: Ctx, body: UserPasswordChange): Promise<void> {
    await withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
      if (!row || !(await verify(row.passwordHash, body.currentPassword)))
        throw new UnprocessableEntityException({ error: 'current_password_incorrect' });
      await tx
        .update(users)
        .set({ passwordHash: await hash(body.newPassword) })
        .where(eq(users.id, ctx.userId));
    });
    await this.refreshTokens.revokeAllForUser(ctx, ctx.userId);
  }

  async signOutEverywhere(ctx: Ctx): Promise<void> {
    await this.refreshTokens.revokeAllForUser(ctx, ctx.userId);
  }

  async get(ctx: Ctx, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await this.selectUserWithRole(tx, id);
      if (!row) throw new NotFoundException({ error: 'user_not_found' });
      return row;
    });
  }

  // Returns a one-time activation token for the admin to relay, rather than persisting an invitation row.
  async invite(ctx: Ctx, input: UserInviteRequest) {
    this.assertGrantAllowed(ctx.role as RoleCode, input.role);

    return withTenantTx(ctx, async (tx) => {
      const [roleRow] = await tx.select().from(roles).where(eq(roles.name, input.role)).limit(1);
      if (!roleRow) throw new UnprocessableEntityException({ error: 'role_not_found' });

      if (input.projectSiteIds && input.role !== 'timekeeper') {
        throw new UnprocessableEntityException({ error: 'role_has_no_site_assignments' });
      }

      // Nobody, including the inviting admin, knows a working password; only activate() sets one.
      const placeholderHash = await hash(randomBytes(32).toString('hex'));

      const [user] = await tx
        .insert(users)
        .values({
          tenantId: ctx.tenantId,
          roleId: roleRow.id,
          // Re-lowercased here too: login lowercases, so a caller bypassing the DTO must not create an unloggable user.
          email: input.email.toLowerCase(),
          passwordHash: placeholderHash,
          status: 'invited',
        })
        .returning()
        .catch((err) => {
          throw isUniqueViolation(err) ? new ConflictException({ error: 'email_taken' }) : err;
        });
      if (!user) throw new Error('users insert returned no row');

      if (input.projectSiteIds && input.projectSiteIds.length > 0) {
        await tx
          .insert(timekeeperSiteAssignments)
          .values(input.projectSiteIds.map((projectSiteId) => ({ tenantId: ctx.tenantId, userId: user.id, projectSiteId })))
          .catch((err) => {
            throw isForeignKeyViolation(err)
              ? new UnprocessableEntityException({ error: 'project_site_not_found' })
              : err;
          });
      }

      await this.audit(tx, ctx, 'CREATE', user.id);
      await this.events.emit(ctx, 'user_invited', { user_id: user.id, role: input.role });

      const activationToken = this.auth.signActivationToken(ctx.tenantId, user.id, placeholderHash);
      return { id: user.id, email: user.email, role: input.role, status: user.status, activationToken };
    });
  }

  // Rerolling the hash invalidates every outstanding activation token for this user.
  async reinvite(ctx: Ctx, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) throw new NotFoundException({ error: 'user_not_found' });
      if (user.status !== 'invited') throw new ConflictException({ error: 'user_not_invited' });

      const placeholderHash = await hash(randomBytes(32).toString('hex'));
      await tx.update(users).set({ passwordHash: placeholderHash }).where(eq(users.id, id));

      await this.audit(tx, ctx, 'UPDATE', id);
      const activationToken = this.auth.signActivationToken(ctx.tenantId, id, placeholderHash);
      return { id, activationToken };
    });
  }

  // Reuses invite/activate: reroll the hash, flip to 'invited', hand back a token bound to the new hash.
  // Also revokes every refresh-token family so a session hijacked before the reset doesn't survive it.
  async resetPassword(ctx: Ctx, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) throw new NotFoundException({ error: 'user_not_found' });
      if (user.status === 'disabled') throw new ConflictException({ error: 'user_disabled' });

      const placeholderHash = await hash(randomBytes(32).toString('hex'));
      await tx.update(users).set({ passwordHash: placeholderHash, status: 'invited' }).where(eq(users.id, id));

      await this.audit(tx, ctx, 'UPDATE', id);
      await this.events.emit(ctx, 'user_password_reset', { user_id: id });
      await this.refreshTokens.revokeAllForUser(ctx, id);

      const activationToken = this.auth.signActivationToken(ctx.tenantId, id, placeholderHash);
      return { id, activationToken };
    });
  }

  // Privilege-escalation policy lives in evaluateUserAdminAction.
  async changeRole(ctx: Ctx, id: string, input: UserRoleChangeRequest) {
    return withTenantTx(ctx, async (tx) => {
      const target = await this.loadTargetForMutation(tx, ctx, id);

      const verdict = evaluateUserAdminAction({
        actorRole: ctx.role as RoleCode,
        actorUserId: ctx.userId,
        targetUserId: id,
        targetRole: target.roleName as RoleCode,
        requestedRole: input.role,
      });
      if (!verdict.allowed) throw new ForbiddenException({ error: verdict.reason });

      const [roleRow] = await tx.select().from(roles).where(eq(roles.name, input.role)).limit(1);
      if (!roleRow) throw new UnprocessableEntityException({ error: 'role_not_found' });

      await tx.update(users).set({ roleId: roleRow.id }).where(eq(users.id, id));
      await this.audit(tx, ctx, 'UPDATE', id);
      await this.events.emit(ctx, 'user_role_changed', { user_id: id, role: input.role });

      // A role change takes effect now, not when the access token's TTL expires.
      await this.refreshTokens.revokeAllForUser(ctx, id);

      return { id, role: input.role };
    });
  }

  async deactivate(ctx: Ctx, id: string) {
    return this.setStatus(ctx, id, 'disabled', 'user_deactivated', /* checkLastManager */ true);
  }

  async reactivate(ctx: Ctx, id: string) {
    return this.setStatus(ctx, id, 'active', 'user_reactivated', /* checkLastManager */ false);
  }

  async getSiteAssignments(ctx: Ctx, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const target = await this.loadTargetForMutation(tx, ctx, id, /* protect */ false);
      if (target.roleName !== 'timekeeper') return { items: [] };

      const rows = await tx
        .select({ projectSiteId: timekeeperSiteAssignments.projectSiteId })
        .from(timekeeperSiteAssignments)
        .where(eq(timekeeperSiteAssignments.userId, id));
      return { items: rows.map((r) => r.projectSiteId) };
    });
  }

  // Declarative: replaces the whole set in one transaction.
  async setSiteAssignments(ctx: Ctx, id: string, input: SiteAssignmentSetRequest) {
    return withTenantTx(ctx, async (tx) => {
      const target = await this.loadTargetForMutation(tx, ctx, id, /* protect */ false);
      if (target.roleName !== 'timekeeper') {
        throw new UnprocessableEntityException({ error: 'role_has_no_site_assignments' });
      }

      await tx.delete(timekeeperSiteAssignments).where(eq(timekeeperSiteAssignments.userId, id));
      if (input.projectSiteIds.length > 0) {
        await tx
          .insert(timekeeperSiteAssignments)
          .values(input.projectSiteIds.map((projectSiteId) => ({ tenantId: ctx.tenantId, userId: id, projectSiteId })))
          .catch((err) => {
            throw isForeignKeyViolation(err)
              ? new UnprocessableEntityException({ error: 'project_site_not_found' })
              : err;
          });
      }

      await this.audit(tx, ctx, 'UPDATE', id);
      await this.events.emit(ctx, 'user_site_assignments_set', { user_id: id, count: input.projectSiteIds.length });

      return { id, projectSiteIds: input.projectSiteIds };
    });
  }

  private async setStatus(
    ctx: Ctx,
    id: string,
    status: 'active' | 'disabled',
    eventName: string,
    checkLastManager: boolean,
  ) {
    return withTenantTx(ctx, async (tx) => {
      const target = await this.loadTargetForMutation(tx, ctx, id);

      const verdict = evaluateUserAdminAction({
        actorRole: ctx.role as RoleCode,
        actorUserId: ctx.userId,
        targetUserId: id,
        targetRole: target.roleName as RoleCode,
        wouldLeaveZeroUserManagers: checkLastManager && (await this.countOtherActiveUserManagers(tx, ctx.tenantId, id)) === 0,
      });
      if (!verdict.allowed) throw new ForbiddenException({ error: verdict.reason });

      await tx.update(users).set({ status }).where(eq(users.id, id));
      await this.audit(tx, ctx, 'UPDATE', id);
      await this.events.emit(ctx, eventName, { user_id: id });

      if (status === 'disabled') await this.refreshTokens.revokeAllForUser(ctx, id);

      return { id, status };
    });
  }

  // An invite has no target user yet, so only the grant allowlist applies.
  private assertGrantAllowed(actorRole: RoleCode, requestedRole: UserInviteRequest['role']): void {
    if (!ROLE_ASSIGNABLE_BY[actorRole].includes(requestedRole)) {
      throw new ForbiddenException({ error: 'role_not_assignable' });
    }
  }

  private async loadTargetForMutation(
    tx: Tx,
    ctx: Ctx,
    id: string,
    protect = true,
  ) {
    const rows = await this.selectUserWithRole(tx, id);
    const target = rows[0];
    // 404, never 403: a 403 would confirm the id exists in another tenant.
    if (!target) throw new NotFoundException({ error: 'user_not_found' });
    if (protect) {
      const verdict = evaluateUserAdminAction({
        actorRole: ctx.role as RoleCode,
        actorUserId: ctx.userId,
        targetUserId: id,
        targetRole: target.roleName as RoleCode,
      });
      if (!verdict.allowed && verdict.reason === 'self_mutation_forbidden') {
        throw new ForbiddenException({ error: verdict.reason });
      }
    }
    return target;
  }

  private selectUserWithRole(tx: Tx, id: string) {
    return tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        roleId: users.roleId,
        roleName: roles.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, id))
      .limit(1);
  }

  // Same role_permissions join as PermissionsGuard, so this can never disagree with the guard.
  private async countOtherActiveUserManagers(
    tx: Tx,
    tenantId: string,
    excludeUserId: string,
  ): Promise<number> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.status, 'active'),
          eq(permissions.code, 'user:manage'),
          ne(users.id, excludeUserId),
        ),
      );
    return new Set(rows.map((r) => r.id)).size;
  }

  private async audit(
    tx: Tx,
    ctx: Ctx,
    action: string,
    entityId: string,
  ): Promise<void> {
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action,
      entity: 'users',
      entityId,
    });
  }
}

const isUniqueViolation = (err: unknown) => pgError(err).code === '23505';
const isForeignKeyViolation = (err: unknown) => pgError(err).code === '23503';
