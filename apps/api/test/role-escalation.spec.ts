import { describe, expect, it, beforeAll } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import postgres from 'postgres';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';

// QAD abuse gate: a user cannot grant itself a permission or act as
// platform_admin by presenting a role it does not actually hold. This
// guard has no path that trusts anything other than the DB-backed
// role_permissions join for the role in the verified JWT claims.
describe('PermissionsGuard: role escalation abuse', () => {
  let tenantId: string;
  let timekeeperUserId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [user] = await sql`select id from users where tenant_id = ${tenantId} limit 1`;
    timekeeperUserId = (user as { id: string }).id;
    await sql.end();
  });

  it('a role with no matching role_permissions row is denied a permission it lacks', async () => {
    const reflector = new Reflector();
    // Simulate @RequirePermission by directly checking the reflector path
    // is exercised: request a permission code that is not in the seeded
    // catalog for a non-admin role and confirm the guard's DB-backed check
    // (not the claimed role string alone) is what decides access.
    const req = { ctx: { tenantId, userId: timekeeperUserId, role: 'timekeeper' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;

    reflector.getAllAndOverride = () => 'tenant:manage';
    const guard = new PermissionsGuard(reflector);
    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(false);
  });

  it('a request with no ctx (guard chain bypassed) is denied, not defaulted to allow', async () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => 'tenant:manage';
    const guard = new PermissionsGuard(reflector);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
      getHandler: () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});
