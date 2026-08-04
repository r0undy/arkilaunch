import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  timekeeperSiteAssignments,
  users,
  withTenantTx,
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
} from '@arkilaunch/shared';
import { AuthService } from '../auth/auth.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { EventsService } from '../events/events.service.js';

type Ctx = RequestContext;

@Injectable()
export class UsersService {
  constructor(
    private readonly auth: AuthService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly events: EventsService,
  ) {}

  // GET /users (S19).
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

      return { items: rows, total: rows.length };
    });
  }

  // GET /users/:id.
  async get(ctx: Ctx, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await this.selectUserWithRole(tx, id);
      if (!row) throw new NotFoundException({ error: 'user_not_found' });
      return row;
    });
  }

  // POST /users (S19 invite). No email provider anywhere in the pinned
  // stack (BUILD §3): the response carries a one-time activation token for
  // the admin to relay out-of-band, rather than persisting an invitation
  // row (see AuthService.activate for the security tradeoff).
  async invite(ctx: Ctx, input: UserInviteRequest) {
    this.assertGrantAllowed(ctx.role as RoleCode, input.role);

    return withTenantTx(ctx, async (tx) => {
      const [roleRow] = await tx.select().from(roles).where(eq(roles.name, input.role)).limit(1);
      if (!roleRow) throw new UnprocessableEntityException({ error: 'role_not_found' });

      if (input.projectSiteIds && input.role !== 'timekeeper') {
        throw new UnprocessableEntityException({ error: 'role_has_no_site_assignments' });
      }

      // Nobody -- including the inviting admin -- ever knows a working
      // password for this row; only activate() can ever set one.
      const placeholderHash = await hash(randomBytes(32).toString('hex'));

      const [user] = await tx
        .insert(users)
        .values({
          tenantId: ctx.tenantId,
          roleId: roleRow.id,
          // Defensive re-lowercase, not just a reliance on the Zod boundary's
          // .toLowerCase() transform: AuthService.login also lowercases
          // before its lookup, so any caller that reaches this service
          // without going through the DTO (as a direct unit test does, or
          // any future internal caller) must not be able to create a user
          // who can never log in.
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

  // POST /users/:id/invite (re-invite): rerolls the placeholder hash,
  // which invalidates every outstanding activation token for this user
  // (bound to the OLD hash) and issues a fresh one -- re-invite is also
  // revoke-previous-invite, with no extra state to track.
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

  // PATCH /users/:id/role (S19). See evaluateUserAdminAction for the
  // privilege-escalation policy this enforces.
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

      // A role change must take effect immediately, not after the access
      // token's own TTL expires (Phase 1A #2's rotate() fix makes this bite).
      await this.refreshTokens.revokeAllForUser(ctx, id);

      return { id, role: input.role };
    });
  }

  // POST /users/:id/deactivate.
  async deactivate(ctx: Ctx, id: string) {
    return this.setStatus(ctx, id, 'disabled', 'user_deactivated', /* checkLastManager */ true);
  }

  // POST /users/:id/reactivate.
  async reactivate(ctx: Ctx, id: string) {
    return this.setStatus(ctx, id, 'active', 'user_reactivated', /* checkLastManager */ false);
  }

  // GET /users/:id/site-assignments.
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

  // PUT /users/:id/site-assignments (S19). Declarative: replaces the whole
  // set inside one transaction, rather than separate add/remove routes.
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

      if (checkLastManager) {
        const remaining = await this.countOtherActiveUserManagers(tx, ctx.tenantId, id);
        const verdict = evaluateUserAdminAction({
          actorRole: ctx.role as RoleCode,
          actorUserId: ctx.userId,
          targetUserId: id,
          targetRole: target.roleName as RoleCode,
          wouldLeaveZeroUserManagers: remaining === 0,
        });
        if (!verdict.allowed) throw new ForbiddenException({ error: verdict.reason });
      } else {
        const verdict = evaluateUserAdminAction({
          actorRole: ctx.role as RoleCode,
          actorUserId: ctx.userId,
          targetUserId: id,
          targetRole: target.roleName as RoleCode,
        });
        if (!verdict.allowed) throw new ForbiddenException({ error: verdict.reason });
      }

      await tx.update(users).set({ status }).where(eq(users.id, id));
      await this.audit(tx, ctx, 'UPDATE', id);
      await this.events.emit(ctx, eventName, { user_id: id });

      if (status === 'disabled') await this.refreshTokens.revokeAllForUser(ctx, id);

      return { id, status };
    });
  }

  // An invite has no target user yet, so the self-mutation/target-role-
  // protection half of evaluateUserAdminAction does not apply here -- just
  // the grant allowlist.
  private assertGrantAllowed(actorRole: RoleCode, requestedRole: UserInviteRequest['role']): void {
    if (!ROLE_ASSIGNABLE_BY[actorRole].includes(requestedRole)) {
      throw new ForbiddenException({ error: 'role_not_assignable' });
    }
  }

  private async loadTargetForMutation(
    tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
    ctx: Ctx,
    id: string,
    protect = true,
  ) {
    const rows = await this.selectUserWithRole(tx, id);
    const target = rows[0];
    // 404, never 403: a 403 would confirm the id exists in some other
    // tenant (RLS already scopes the select to ctx.tenantId).
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

  private selectUserWithRole(tx: Parameters<Parameters<typeof withTenantTx>[1]>[0], id: string) {
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

  // Counts active users (excluding `excludeUserId`) whose role holds
  // user:manage -- the same role_permissions join PermissionsGuard itself
  // uses, so this can never disagree with what the guard would allow.
  private async countOtherActiveUserManagers(
    tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
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
    tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
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

// Postgres unique_violation / foreign_key_violation error codes -- maps a
// constraint violation to a clean 4xx instead of an uncaught 500.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505';
}
function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23503';
}
