import { describe, expect, it, beforeAll } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import postgres from 'postgres';
import { PDFDocument } from 'pdf-lib';
import { LEAKAGE_BONES, LeakageReportQuerySchema, type RequestContext } from '@arkilaunch/shared';
import { FleetService } from '../src/fleet/fleet.service.js';
import { EventsService } from '../src/events/events.service.js';
import { FleetController } from '../src/fleet/fleet.controller.js';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator.js';

describe('Revenue leakage report', () => {
  const fleet = new FleetService(new EventsService());
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let typeIds: string[];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [a] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [b] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const [adminA] = await sql`select id from users where tenant_id = ${a!.id} limit 1`;
    const [adminB] = await sql`select id from users where tenant_id = ${b!.id} limit 1`;
    typeIds = (await sql`select id from equipment_types order by name limit 2`).map((r) => r.id as string);
    ctxA = { tenantId: a!.id, userId: adminA!.id, role: 'admin' };
    ctxB = { tenantId: b!.id, userId: adminB!.id, role: 'admin' };
    await sql.end();
  });

  it('answers every bone of the fishbone', async () => {
    const r = await fleet.leakageReport(ctxA, {});
    expect(new Set(r.causes.map((c) => c.bone))).toEqual(new Set(LEAKAGE_BONES));
    expect(r.period.to >= r.period.from).toBe(true);
  });

  it('never shows one tenant another tenant\'s fleet', async () => {
    const [a, b] = await Promise.all([fleet.leakageReport(ctxA, {}), fleet.leakageReport(ctxB, {})]);
    const unit = await fleet.create(ctxA, {
      equipmentTypeId: typeIds[0]!,
      model: 'Leakage Isolation Unit',
      serialNo: `leakage-iso-${Date.now()}`,
      availabilityStatus: 'available',
    });
    const [aAfter, bAfter] = await Promise.all([fleet.leakageReport(ctxA, {}), fleet.leakageReport(ctxB, {})]);
    expect(aAfter.master.fleetTotal).toBeGreaterThan(a.master.fleetTotal);
    expect(bAfter.master.fleetTotal).toBe(b.master.fleetTotal);
    // Tenant B's utilization is its own units only.
    const utilB = await fleet.utilizationReport(ctxB, {});
    expect(utilB.fleet.some((f) => f.equipmentId === unit.id)).toBe(false);
  });

  it('narrows the fleet to the chosen equipment type', async () => {
    const all = await fleet.leakageReport(ctxA, {});
    const typed = await fleet.leakageReport(ctxA, { equipmentTypeId: typeIds[0]! });
    expect(typed.master.fleetTotal).toBeLessThanOrEqual(all.master.fleetTotal);
    expect(typed.filters.equipmentType).toEqual(expect.any(String));
    // Trucks cannot be tied to a type, so a filtered report says "no data" rather than a count.
    expect(typed.ledger.truckTrips).toBe(0);
  });

  it('returns a downloadable PDF', async () => {
    const res = await fleet.leakageReportPdf(ctxA, { from: '2026-09-01', to: '2026-09-30' });
    expect(res.filename).toBe('revenue-leakage-2026-09-01-to-2026-09-30.pdf');
    const doc = await PDFDocument.load(Buffer.from(res.contentBase64, 'base64'));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('rejects a reversed or over-long range', () => {
    expect(LeakageReportQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false);
    expect(LeakageReportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-09-01' }).success).toBe(false);
    expect(LeakageReportQuerySchema.safeParse({ customerId: 'not-a-uuid' }).success).toBe(false);
  });

  it('is gated by report:read on both routes', async () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSION_KEY, FleetController.prototype.leakageReport)).toEqual(['report:read']);
    expect(reflector.get(PERMISSION_KEY, FleetController.prototype.leakageReportPdf)).toEqual(['report:read']);
    reflector.getAllAndOverride = () => ['report:read'];
    const req = { ctx: { tenantId: ctxA.tenantId, userId: ctxA.userId, role: 'timekeeper' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;
    expect(await new PermissionsGuard(reflector).canActivate(context)).toBe(false);
  });
});
