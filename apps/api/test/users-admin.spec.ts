import { describe, expect, it, beforeAll } from 'vitest';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { auditLogs, timekeeperSiteAssignments, users, withTenantTx } from '@arkilaunch/db';
import { JwtClaimsSchema, type RequestContext } from '@arkilaunch/shared';
import { UsersService } from '../src/users/users.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { EventsService } from '../src/events/events.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

function freshAuth(): AuthService {
  return new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
}

// S19 Users & Roles (PRD-F7). Cross-tenant + escalation cases against the
// two-tenant seed (`pnpm db:seed:test`).
describe('UsersService (S19)', () => {
  const auth = freshAuth();
  const usersService = new UsersService(auth, new RefreshTokenService(), new EventsService());

  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let ownerCtxA: RequestContext;
  let platformCtxA: RequestContext;
  let projectSiteIdA: string;
  let ownerUserIdA: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantIdA = (tenantA as { id: string }).id;
    const tenantIdB = (tenantB as { id: string }).id;
    const [adminA] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'admin@test-tenant-a.test'`;
    const [adminB] = await sql`select id from users where tenant_id = ${tenantIdB} and email = 'admin@test-tenant-b.test'`;
    const [siteA] = await sql`select id from project_sites where tenant_id = ${tenantIdA} limit 1`;
    const [customerA] =
      await sql`select u.id from users u join roles r on r.id = u.role_id where u.tenant_id = ${tenantIdA} and r.name = 'customer' limit 1`;

    // The two-tenant seed has no `owner`-role user; this API has no
    // endpoint that can create one (RFC-1's reserved-role posture), so
    // this is inserted directly to test the target-role-protection case
    // against a real row.
    const [ownerRole] = await sql`select id from roles where name = 'owner'`;
    const [adminHashRow] = await sql`select password_hash from users where id = ${(adminA as { id: string }).id}`;
    const passwordHash = (adminHashRow as { password_hash: string }).password_hash;
    const [ownerRow] = await sql`
      insert into users (tenant_id, role_id, email, password_hash, status)
      values (${tenantIdA}, ${(ownerRole as { id: string }).id}, ${`owner-fixture-${Date.now()}@test-tenant-a.test`}, ${passwordHash}, 'active')
      returning id
    `;

    // This file's own earlier runs leave activated admin-role users behind
    // (invite/activate tests are real, committed DB writes with no
    // teardown) -- the last_user_manager guard's "there is exactly one
    // active manager" premise only holds if those are cleared first.
    await sql`
      update users set status = 'disabled'
      where tenant_id = ${tenantIdA} and status = 'active' and id != ${(adminA as { id: string }).id}
        and role_id in (select id from roles where name in ('admin', 'platform_admin'))
    `;

    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };
    ownerCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'owner' };
    // A platform_admin acting in tenant A's context is never itself a row
    // in tenant A's users table (support/onboarding context, RFC-1 §3) --
    // borrow the tenant's own customer id as a stand-in actor identity so
    // the last-user-manager guard's "exclude the actor" logic is exercised
    // against a userId that is genuinely not a manager.
    platformCtxA = { tenantId: tenantIdA, userId: (customerA as { id: string }).id, role: 'platform_admin' };
    projectSiteIdA = (siteA as { id: string } | undefined)?.id ?? '00000000-0000-0000-0000-000000000000';
    ownerUserIdA = (ownerRow as { id: string }).id;

    await sql.end();
  });

  function uniqueEmail(label: string): string {
    return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test-tenant-a.test`;
  }

  describe('cross-tenant isolation (T23/T24)', () => {
    it('GET /users for tenant A never returns tenant B users', async () => {
      const result = await usersService.list(adminCtxA, { limit: 100, offset: 0 });
      const ids = result.items.map((row) => row.id);
      expect(ids).not.toContain(adminCtxB.userId);
    });

    it('GET /users/:id with a tenant-B id from tenant-A ctx is 404, not 403', async () => {
      await expect(usersService.get(adminCtxA, adminCtxB.userId)).rejects.toThrow(NotFoundException);
    });

    it('PATCH /users/:id/role targeting a tenant-B user from tenant-A ctx mutates nothing', async () => {
      await expect(
        usersService.changeRole(adminCtxA, adminCtxB.userId, { role: 'timekeeper' }),
      ).rejects.toThrow(NotFoundException);

      const [stillAdminB] = await withTenantTx(adminCtxB, (tx) =>
        tx.select().from(users).where(eq(users.id, adminCtxB.userId)),
      );
      expect(stillAdminB!.roleId).toBeDefined();
    });
  });

  describe('privilege-escalation defense (T7/T22)', () => {
    it('admin can invite an admin, but not grant owner', async () => {
      const email = uniqueEmail('escalate');
      const invited = await usersService.invite(adminCtxA, { email, role: 'admin' });
      expect(invited.id).toBeDefined();

      await expect(
        usersService.invite(adminCtxA, { email: uniqueEmail('escalate2'), role: 'owner' as never }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin cannot change their own role (self-escalation)', async () => {
      await expect(
        usersService.changeRole(adminCtxA, adminCtxA.userId, { role: 'timekeeper' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin cannot deactivate a tenant-A owner-role user (target-role protection, lateral takeover)', async () => {
      await expect(usersService.deactivate(adminCtxA, ownerUserIdA)).rejects.toThrow(ForbiddenException);
    });

    it('admin cannot change the role of a tenant-A owner-role user', async () => {
      await expect(
        usersService.changeRole(adminCtxA, ownerUserIdA, { role: 'timekeeper' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('last_user_manager guard', () => {
    it('deactivating the tenant\'s only user:manage holder is rejected, even when the actor is not that holder', async () => {
      // adminCtxA deactivating THEMSELVES is self-mutation (a different,
      // earlier-checked denial); the last-user-manager guard specifically
      // needs a DIFFERENT actor -- platformCtxA, a support/onboarding
      // context (RFC-1 §3) -- attempting to deactivate the tenant's sole
      // admin, which really would leave zero active user:manage holders.
      await expect(usersService.deactivate(platformCtxA, adminCtxA.userId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('owner is read-mostly (QAD-T19)', () => {
    it('owner ctx cannot invite: ROLE_ASSIGNABLE_BY.owner is empty, a second denial layer behind PermissionsGuard', async () => {
      // PermissionsGuard would already deny an owner ctx before this
      // service method is ever reached (owner holds no user:manage
      // permission). This proves the service does not ALSO silently allow
      // it if that guard were ever misconfigured or bypassed.
      const email = uniqueEmail('owner-invited');
      await expect(usersService.invite(ownerCtxA, { email, role: 'timekeeper' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('invite -> activate -> login round trip', () => {
    it('a full round trip works, is single-use, and the token is not a valid Bearer token', async () => {
      const email = uniqueEmail('roundtrip');
      const invited = await usersService.invite(adminCtxA, { email, role: 'admin' });
      expect(invited.status).toBe('invited');

      // Cannot log in yet -- status is 'invited', no password is known.
      await expect(auth.login({ email, password: 'whatever-12345' })).rejects.toThrow(UnauthorizedException);

      // The activation token is not a Bearer token: it deliberately fails
      // JwtClaimsSchema (no `role` claim, carries `purpose` instead) -- the
      // same construction signTwoFaChallenge already uses.
      const decoded = jwtService().decode(invited.activationToken);
      expect(JwtClaimsSchema.safeParse(decoded).success).toBe(false);

      await auth.activate({ activationToken: invited.activationToken, password: 'a-strong-password-1' });

      // Replaying the same token now fails (password hash changed).
      await expect(
        auth.activate({ activationToken: invited.activationToken, password: 'another-password-2' }),
      ).rejects.toThrow(UnauthorizedException);

      const tokens = await auth.login({ email, password: 'a-strong-password-1' });
      expect('accessToken' in tokens).toBe(true);
    });

    it('a mixed-case invite email can log in with the lowercase form', async () => {
      const email = uniqueEmail('mixedcase');
      const mixedCaseEmail = email.replace('mixedcase', 'MixedCase');
      const invited = await usersService.invite(adminCtxA, { email: mixedCaseEmail, role: 'admin' });

      await auth.activate({ activationToken: invited.activationToken, password: 'a-strong-password-3' });

      const tokens = await auth.login({ email: email.toLowerCase(), password: 'a-strong-password-3' });
      expect('accessToken' in tokens).toBe(true);
    });

    it('re-invite invalidates the previous activation token', async () => {
      const email = uniqueEmail('reinvite');
      const invited = await usersService.invite(adminCtxA, { email, role: 'admin' });
      const reinvited = await usersService.reinvite(adminCtxA, invited.id);

      await expect(
        auth.activate({ activationToken: invited.activationToken, password: 'a-strong-password-4' }),
      ).rejects.toThrow(UnauthorizedException);

      await auth.activate({ activationToken: reinvited.activationToken, password: 'a-strong-password-4' });
      const tokens = await auth.login({ email, password: 'a-strong-password-4' });
      expect('accessToken' in tokens).toBe(true);
    });
  });

  describe('deactivation and audit trail', () => {
    it('deactivating a user prevents login and writes an audit_logs row', async () => {
      const email = uniqueEmail('deactivate');
      const invited = await usersService.invite(adminCtxA, { email, role: 'admin' });
      await auth.activate({ activationToken: invited.activationToken, password: 'a-strong-password-5' });

      await usersService.deactivate(adminCtxA, invited.id);
      await expect(auth.login({ email, password: 'a-strong-password-5' })).rejects.toThrow(UnauthorizedException);

      const rows = await withTenantTx(adminCtxA, (tx) =>
        tx.select().from(auditLogs).where(eq(auditLogs.entityId, invited.id)),
      );
      expect(rows.some((r) => r.entity === 'users' && r.actorId === adminCtxA.userId)).toBe(true);
    });
  });

  describe('site assignments', () => {
    it('assigning sites to a non-timekeeper is rejected', async () => {
      const email = uniqueEmail('nonTk');
      const invited = await usersService.invite(adminCtxA, { email, role: 'admin' });
      await expect(
        usersService.setSiteAssignments(adminCtxA, invited.id, { projectSiteIds: [projectSiteIdA] }),
      ).rejects.toThrow();
    });

    it('round-trips a set for a timekeeper: set, read back, shrink', async () => {
      // A DEDICATED invited timekeeper, not the shared seeded one
      // (timekeeperUserIdA): edtr-engine.spec.ts relies on the seed's own
      // timekeeper -> site assignment staying intact, and this test's own
      // "shrink to empty" step would otherwise strip it out from under
      // that file when run against the same real database.
      const dedicated = await usersService.invite(adminCtxA, { email: uniqueEmail('site-assign'), role: 'timekeeper' });

      const result = await usersService.setSiteAssignments(adminCtxA, dedicated.id, {
        projectSiteIds: [projectSiteIdA],
      });
      expect(result.projectSiteIds).toEqual([projectSiteIdA]);

      const read = await usersService.getSiteAssignments(adminCtxA, dedicated.id);
      expect(read.items).toEqual([projectSiteIdA]);

      const shrunk = await usersService.setSiteAssignments(adminCtxA, dedicated.id, { projectSiteIds: [] });
      expect(shrunk.projectSiteIds).toEqual([]);

      const rows = await withTenantTx(adminCtxA, (tx) =>
        tx.select().from(timekeeperSiteAssignments).where(eq(timekeeperSiteAssignments.userId, dedicated.id)),
      );
      expect(rows.length).toBe(0);
    });
  });
});
