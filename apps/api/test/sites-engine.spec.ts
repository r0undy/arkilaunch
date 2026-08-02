import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { addresses, equipment as equipmentTable, events, projectSites, rentals, weatherAlerts, withTenantTx } from '@arkilaunch/db';
import { eq } from 'drizzle-orm';
import type { RequestContext } from '@arkilaunch/shared';
import { SitesService } from '../src/sites/sites.service.js';
import { EventsService } from '../src/events/events.service.js';

// PRD-F4/F5 read+write surface backing S12/S13/S14
// (cr-arkilaunch-f9-read-surface.md). Uses a dedicated equipment unit
// (not the shared fixture units edtr-engine.spec.ts / bookings-engine.spec.ts
// mutate) since deployment writes flip equipment.availabilityStatus.
describe('SitesService (PRD-F4/F5)', () => {
  const sites = new SitesService(new EventsService());
  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let equipmentTypeIdA: string;
  let dedicatedEquipmentId: string;
  let dedicatedRentalId: string;
  let siteIdA: string;

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
    const [equipmentType] = await sql`select id from equipment_types limit 1`;
    const [customerA] = await sql`select id from customers where tenant_id = ${tenantIdA} limit 1`;

    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };
    equipmentTypeIdA = (equipmentType as { id: string }).id;

    // A dedicated site + unit + rental (rental.project_site_id === this
    // site) so this file's deployment writes never touch rows other spec
    // files mutate concurrently, and createDeployment's own
    // rental.projectSiteId === siteId check (sites.service.ts) always holds.
    await withTenantTx(adminCtxA, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId: tenantIdA, line1: 'Sites Test Rd', city: 'Taguig', province: 'Metro Manila', country: 'PH' })
        .returning();
      const [site] = await tx
        .insert(projectSites)
        .values({ tenantId: tenantIdA, addressId: address!.id, latitude: '14.500000', longitude: '121.050000' })
        .returning();
      siteIdA = site!.id;

      const serialNo = `test-tenant-a-serial-sites-${Date.now()}`;
      const [equipmentRow] = await tx
        .insert(equipmentTable)
        .values({ tenantId: tenantIdA, equipmentTypeId: equipmentTypeIdA, model: 'Sites Test Unit', serialNo })
        .returning();
      dedicatedEquipmentId = equipmentRow!.id;

      const [rental] = await tx
        .insert(rentals)
        .values({
          tenantId: tenantIdA,
          customerId: (customerA as { id: string }).id,
          projectSiteId: siteIdA,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      dedicatedRentalId = rental!.id;
    });

    await sql.end();
  });

  it('GET /sites/:id reads back the fixture site; PATCH updates coordinates', async () => {
    const detail = await sites.get(adminCtxA, siteIdA);
    expect(detail.address?.city).toBe('Taguig');

    const { items, total } = await sites.list(adminCtxA);
    expect(total).toBeGreaterThan(0);
    expect(items.some((item) => item.id === siteIdA)).toBe(true);

    const updated = await sites.update(adminCtxA, siteIdA, { latitude: 14.6 });
    expect(updated.latitude).toBeCloseTo(14.6, 5);
  });

  it('POST /sites creates a new site with its own address', async () => {
    const created = await sites.create(adminCtxA, {
      address: { line1: '99 Yard Rd', city: 'Pasig', province: 'Metro Manila', country: 'PH' },
      latitude: 14.55,
      longitude: 121.08,
    });
    expect(created.latitude).toBeCloseTo(14.55, 5);

    const detail = await sites.get(adminCtxA, created.id);
    expect(detail.address?.city).toBe('Pasig');
  });

  it('POST /sites/:id/deployments deploys equipment, blocking an overlapping deployment (QAD-T21), then return frees it', async () => {
    const start = '2031-01-01T00:00:00.000Z';
    const end = '2031-01-05T00:00:00.000Z';

    const deployment = await sites.createDeployment(adminCtxA, siteIdA, {
      equipmentId: dedicatedEquipmentId,
      rentalId: dedicatedRentalId,
      start,
      end,
    });
    expect(deployment.status).toBe('scheduled');

    const [afterDeploy] = await withTenantTx(adminCtxA, (tx) =>
      tx.select().from(equipmentTable).where(eq(equipmentTable.id, dedicatedEquipmentId)).limit(1),
    );
    expect(afterDeploy!.availabilityStatus).toBe('deployed');

    // QAD-T16/T21: already-deployed -- refused with an explaining reason,
    // never double-booked.
    await expect(
      sites.createDeployment(adminCtxA, siteIdA, {
        equipmentId: dedicatedEquipmentId,
        rentalId: dedicatedRentalId,
        start,
        end,
      }),
    ).rejects.toThrow(ConflictException);

    const returned = await sites.returnDeployment(adminCtxA, siteIdA, deployment.id);
    expect(returned.status).toBe('completed');

    const [afterReturn] = await withTenantTx(adminCtxA, (tx) =>
      tx.select().from(equipmentTable).where(eq(equipmentTable.id, dedicatedEquipmentId)).limit(1),
    );
    expect(afterReturn!.availabilityStatus).toBe('available');

    // A returned deployment cannot be returned twice.
    await expect(sites.returnDeployment(adminCtxA, siteIdA, deployment.id)).rejects.toThrow(ConflictException);
  });

  // QAD-T16: a maintenance-flagged unit cannot be deployed either.
  it('QAD-T16: refuses to deploy a maintenance-flagged unit', async () => {
    const [flaggedUnit] = await withTenantTx(adminCtxA, (tx) =>
      tx
        .insert(equipmentTable)
        .values({
          tenantId: adminCtxA.tenantId,
          equipmentTypeId: equipmentTypeIdA,
          model: 'Flagged Sites Test Unit',
          serialNo: `test-tenant-a-serial-sites-flagged-${Date.now()}`,
          availabilityStatus: 'maintenance',
        })
        .returning(),
    );

    await expect(
      sites.createDeployment(adminCtxA, siteIdA, {
        equipmentId: flaggedUnit!.id,
        rentalId: dedicatedRentalId,
        start: '2031-03-01T00:00:00.000Z',
        end: '2031-03-05T00:00:00.000Z',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // QAD-T24: a spoofed/foreign site id is denied by RLS, not an app filter.
  it('QAD-T24: a tenant B admin cannot deploy equipment against tenant A\'s site', async () => {
    await expect(
      sites.createDeployment(adminCtxB, siteIdA, {
        equipmentId: dedicatedEquipmentId,
        rentalId: dedicatedRentalId,
        start: '2031-02-01T00:00:00.000Z',
        end: '2031-02-05T00:00:00.000Z',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('GET /weather/advisories surfaces an active advisory; GET /incidents reads the liability event, tenant-scoped', async () => {
    await withTenantTx(adminCtxA, (tx) =>
      tx.insert(weatherAlerts).values({
        tenantId: adminCtxA.tenantId,
        projectSiteId: siteIdA,
        severity: 'warning',
        observed: { tempC: 31, windKph: 65, precipMm: 5, code: 3 },
        isStale: false,
        effectiveAt: new Date(),
        status: 'active',
      }),
    );
    const { items: advisories } = await sites.advisories(adminCtxA);
    expect(advisories.some((advisory) => advisory.siteId === siteIdA && advisory.advisory.severity === 'warning')).toBe(
      true,
    );

    await withTenantTx(adminCtxA, (tx) =>
      tx.insert(events).values({
        tenantId: adminCtxA.tenantId,
        name: 'weather_liability_incident',
        properties: { project_site_id: siteIdA, severity: 'warning', observed: { tempC: 31 } },
      }),
    );
    const { items: incidents } = await sites.incidents(adminCtxA, { projectSiteId: siteIdA });
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents.every((incident) => incident.projectSiteId === siteIdA)).toBe(true);

    // Tenant B sees none of tenant A's incidents (RLS).
    const { items: crossTenantIncidents } = await sites.incidents(adminCtxB, { projectSiteId: siteIdA });
    expect(crossTenantIncidents.length).toBe(0);
  });
});
