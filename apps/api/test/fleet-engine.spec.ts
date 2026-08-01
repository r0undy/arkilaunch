import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import postgres from 'postgres';
import type { RequestContext } from '@arkilaunch/shared';
import { FleetService } from '../src/fleet/fleet.service.js';
import { EventsService } from '../src/events/events.service.js';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';

// PRD-F4 (Fleet Inventory, Maintenance & Reporting): QAD-T16 (deploy a
// flagged/busy unit), QAD-T19 (owner denied a data-entry permission),
// QAD-T30 (injection in free-text), plus the endpoints' happy paths.
describe('FleetService (PRD-F4)', () => {
  const fleet = new FleetService(new EventsService());
  let adminCtx: RequestContext;
  let equipmentTypeId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [equipmentType] = await sql`select id from equipment_types limit 1`;

    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    equipmentTypeId = (equipmentType as { id: string }).id;

    await sql.end();
  });

  it('creates a unit, lists it, and filters by status', async () => {
    const created = await fleet.create(adminCtx, {
      equipmentTypeId,
      model: 'Fleet Test Loader',
      serialNo: `fleet-test-${Date.now()}-a`,
      availabilityStatus: 'available',
    });
    expect(created.runtimeHours).toBe(0);

    const { items, total } = await fleet.list(adminCtx, { status: 'available' });
    expect(total).toBeGreaterThan(0);
    expect(items.some((item) => item.id === created.id)).toBe(true);
  });

  it('rejects a duplicate serial number for the same tenant', async () => {
    const serialNo = `fleet-test-${Date.now()}-dup`;
    await fleet.create(adminCtx, { equipmentTypeId, model: 'Unit A', serialNo, availabilityStatus: 'available' });

    await expect(
      fleet.create(adminCtx, { equipmentTypeId, model: 'Unit B', serialNo, availabilityStatus: 'available' }),
    ).rejects.toThrow(ConflictException);
  });

  // QAD-T16: an already-deployed unit cannot be deployed again.
  it('QAD-T16: refuses to deploy a unit that is already deployed', async () => {
    const created = await fleet.create(adminCtx, {
      equipmentTypeId,
      model: 'Already Deployed Unit',
      serialNo: `fleet-test-${Date.now()}-deployed`,
      availabilityStatus: 'deployed',
    });

    await expect(fleet.update(adminCtx, created.id, { availabilityStatus: 'deployed' })).rejects.toThrow(
      ConflictException,
    );
  });

  // QAD-T16: a maintenance-flagged unit cannot be deployed.
  it('QAD-T16: refuses to deploy a maintenance-flagged unit', async () => {
    const created = await fleet.create(adminCtx, {
      equipmentTypeId,
      model: 'Flagged Unit',
      serialNo: `fleet-test-${Date.now()}-flagged`,
      availabilityStatus: 'available',
    });

    // runtime_hours defaults to 0; a schedule with next_due = 0 means the
    // unit is already past its threshold (0 >= 0).
    const { withTenantTx, maintenanceSchedules } = await import('@arkilaunch/db');
    await withTenantTx(adminCtx, (tx) =>
      tx.insert(maintenanceSchedules).values({
        tenantId: adminCtx.tenantId,
        equipmentId: created.id,
        hoursInterval: '250.00',
        nextDue: '0.00',
      }),
    );

    await expect(fleet.update(adminCtx, created.id, { availabilityStatus: 'deployed' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('a maintenance-flagged unit CAN be moved to `available` or `maintenance` (only `deployed` is guarded)', async () => {
    const created = await fleet.create(adminCtx, {
      equipmentTypeId,
      model: 'Flagged But Idle Unit',
      serialNo: `fleet-test-${Date.now()}-flagged-idle`,
      availabilityStatus: 'available',
    });
    const { withTenantTx, maintenanceSchedules } = await import('@arkilaunch/db');
    await withTenantTx(adminCtx, (tx) =>
      tx.insert(maintenanceSchedules).values({
        tenantId: adminCtx.tenantId,
        equipmentId: created.id,
        hoursInterval: '250.00',
        nextDue: '0.00',
      }),
    );

    const updated = await fleet.update(adminCtx, created.id, { availabilityStatus: 'maintenance' });
    expect(updated.availabilityStatus).toBe('maintenance');
  });

  it('recording a maintenance log advances next_due past the current runtime hours', async () => {
    const created = await fleet.create(adminCtx, {
      equipmentTypeId,
      model: 'Serviceable Unit',
      serialNo: `fleet-test-${Date.now()}-serviceable`,
      availabilityStatus: 'available',
    });
    const { withTenantTx, maintenanceSchedules } = await import('@arkilaunch/db');
    await withTenantTx(adminCtx, (tx) =>
      tx.insert(maintenanceSchedules).values({
        tenantId: adminCtx.tenantId,
        equipmentId: created.id,
        hoursInterval: '250.00',
        nextDue: '0.00',
      }),
    );

    // Past due (0 >= 0): deploying is refused until the log resets it.
    await expect(fleet.update(adminCtx, created.id, { availabilityStatus: 'deployed' })).rejects.toThrow(
      ConflictException,
    );

    await fleet.recordMaintenanceLog(adminCtx, created.id, {
      performedAt: new Date().toISOString(),
      notes: 'Routine service',
    });

    const detail = await fleet.maintenanceDetail(adminCtx, created.id);
    expect(detail.schedule?.nextDue).toBe(250); // 0 runtime_hours + 250 hours_interval
    expect(detail.logs.length).toBeGreaterThan(0);

    // Now deployable again -- the threshold has been reset ahead of current runtime.
    const updated = await fleet.update(adminCtx, created.id, { availabilityStatus: 'deployed' });
    expect(updated.availabilityStatus).toBe('deployed');
  });

  // QAD-T30: SQL/XSS payload in a free-text field is stored and returned
  // inert -- parameterized queries and Zod validation neutralize it,
  // never string-built into SQL, never unescaped HTML.
  it('QAD-T30: an injection payload in maintenance-log notes is stored and returned verbatim, never executed', async () => {
    const created = await fleet.create(adminCtx, {
      equipmentTypeId,
      model: 'Injection Test Unit',
      serialNo: `fleet-test-${Date.now()}-injection`,
      availabilityStatus: 'available',
    });
    const payload = "'; DROP TABLE equipment; --<script>alert(1)</script>";

    await fleet.recordMaintenanceLog(adminCtx, created.id, {
      performedAt: new Date().toISOString(),
      notes: payload,
    });

    const detail = await fleet.maintenanceDetail(adminCtx, created.id);
    expect(detail.logs[0]!.notes).toBe(payload);

    // The table this payload targets is still there and still queryable.
    const stillThere = await fleet.list(adminCtx, {});
    expect(stillThere.total).toBeGreaterThan(0);
  });

  it('reports utilization for the fleet over a period', async () => {
    const report = await fleet.utilizationReport(adminCtx, {});
    expect(report.period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.period.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(report.fleet)).toBe(true);
  });

  // QAD-T19: an owner (report:read only, no fleet:manage) is denied a
  // data-entry permission -- the RBAC guard, not FleetService, is what
  // enforces this at the controller boundary (same technique as
  // role-escalation.spec.ts).
  it('QAD-T19: PermissionsGuard denies owner the fleet:manage permission but allows report:read', async () => {
    const reflector = new Reflector();
    const req = { ctx: { tenantId: adminCtx.tenantId, userId: adminCtx.userId, role: 'owner' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;

    reflector.getAllAndOverride = () => 'fleet:manage';
    const deniedGuard = new PermissionsGuard(reflector);
    expect(await deniedGuard.canActivate(context)).toBe(false);

    reflector.getAllAndOverride = () => 'report:read';
    const allowedGuard = new PermissionsGuard(reflector);
    expect(await allowedGuard.canActivate(context)).toBe(true);
  });
});
