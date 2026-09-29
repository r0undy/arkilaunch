import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  addresses,
  equipment as equipmentTable,
  equipmentAssignments,
  projectSites,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext, SiteDeploymentFilter, SiteResponse } from '@arkilaunch/shared';
import { SitesService } from '../src/sites/sites.service.js';
import { EventsService } from '../src/events/events.service.js';

// QA item 23: GET /sites tells a site with machines on it from one with
// machines arriving and one with nothing, and the ?deployment= filter's
// total matches its rows. Dedicated sites/units, removed afterwards, so the
// tenant-wide listing other specs read does not grow run over run.
describe('GET /sites deployment state (QA-23)', () => {
  const sites = new SitesService(new EventsService());
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let customerNameA: string;
  const ids = { active: '', upcoming: '', idle: '', foreign: '' };
  let unitCount = 0;

  const day = 24 * 60 * 60 * 1000;
  const inDays = (n: number) => new Date(Date.now() + n * day);

  // Every page of a filter, so the checks do not depend on how many sites
  // other specs have left in the tenant.
  async function listAll(ctx: RequestContext, deployment?: SiteDeploymentFilter) {
    const items: SiteResponse[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await sites.list(ctx, { limit: 100, offset, ...(deployment ? { deployment } : {}) });
      items.push(...page.items);
      if (page.items.length < 100) return { items, total: page.total };
    }
  }

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
    const [customerA] = await sql`select id, company_name from customers where tenant_id = ${tenantIdA} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    const [customerB] = await sql`select id from customers where tenant_id = ${tenantIdB} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    await sql.end();

    ctxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    ctxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };
    const typeId = (equipmentType as { id: string }).id;
    const customerIdA = (customerA as { id: string }).id;
    customerNameA = (customerA as { company_name: string }).company_name;
    const stamp = Date.now();

    type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
    const make = {
      site: async (tx: Tx, tenant: 'A' | 'B', customerId: string | null) => {
        const ctx = tenant === 'A' ? ctxA : ctxB;
        const [address] = await tx
          .insert(addresses)
          .values({ tenantId: ctx.tenantId, line1: 'QA23 Rd', city: `QA23 ${tenant}`, province: 'Metro Manila', country: 'PH' })
          .returning();
        const [site] = await tx
          .insert(projectSites)
          .values({ tenantId: ctx.tenantId, addressId: address!.id, customerId, latitude: '14.500000', longitude: '121.050000' })
          .returning();
        return site!.id;
      },
      unit: async (tx: Tx, tenant: 'A' | 'B', availabilityStatus: string) => {
        const ctx = tenant === 'A' ? ctxA : ctxB;
        const [unit] = await tx
          .insert(equipmentTable)
          .values({
            tenantId: ctx.tenantId,
            equipmentTypeId: typeId,
            model: 'QA23 Unit',
            serialNo: `test-qa23-${tenant}-${stamp}-${unitCount++}`,
            availabilityStatus,
          })
          .returning();
        return unit!.id;
      },
      rental: async (tx: Tx, tenant: 'A' | 'B', customerId: string, siteId: string, status: string) => {
        const ctx = tenant === 'A' ? ctxA : ctxB;
        const [rental] = await tx
          .insert(rentals)
          .values({ tenantId: ctx.tenantId, customerId, projectSiteId: siteId, status, startDate: new Date() })
          .returning();
        return rental!.id;
      },
    };
    const assign = (tx: Tx, tenantId: string, equipmentId: string, rentalId: string, start: Date, status: string) =>
      tx.insert(equipmentAssignments).values({ tenantId, equipmentId, rentalId, start, end: inDays(60), status });

    await withTenantTx(ctxA, async (tx) => {
      // Active site (a customer's): one delivered unit, one legacy
      // POST /sites/:id/deployments unit (scheduled but already deployed).
      ids.active = await make.site(tx, 'A', customerIdA);
      const delivered = await make.unit(tx, 'A', 'deployed');
      const legacy = await make.unit(tx, 'A', 'deployed');
      const activeRental = await make.rental(tx, 'A', customerIdA, ids.active, 'active');
      await assign(tx, ctxA.tenantId, delivered, activeRental, inDays(-5), 'active');
      await assign(tx, ctxA.tenantId, legacy, activeRental, inDays(-1), 'scheduled');

      // Upcoming site (company yard): a confirmed unit due in 3 days, plus
      // a booking of the delivered unit above -- deployed elsewhere, so it
      // is neither on site here nor counted as arriving.
      ids.upcoming = await make.site(tx, 'A', null);
      const yardUnit = await make.unit(tx, 'A', 'available');
      const upcomingRental = await make.rental(tx, 'A', customerIdA, ids.upcoming, 'confirmed');
      await assign(tx, ctxA.tenantId, yardUnit, upcomingRental, inDays(3), 'scheduled');
      await assign(tx, ctxA.tenantId, delivered, upcomingRental, inDays(4), 'scheduled');

      // Idle site: a booking a month out and a finished one.
      ids.idle = await make.site(tx, 'A', null);
      const idleUnit = await make.unit(tx, 'A', 'available');
      const laterRental = await make.rental(tx, 'A', customerIdA, ids.idle, 'confirmed');
      await assign(tx, ctxA.tenantId, idleUnit, laterRental, inDays(30), 'scheduled');
      const doneRental = await make.rental(tx, 'A', customerIdA, ids.idle, 'completed');
      await assign(tx, ctxA.tenantId, idleUnit, doneRental, inDays(-20), 'completed');
    });

    await withTenantTx(ctxB, async (tx) => {
      ids.foreign = await make.site(tx, 'B', null);
      const unit = await make.unit(tx, 'B', 'deployed');
      const rental = await make.rental(tx, 'B', (customerB as { id: string }).id, ids.foreign, 'active');
      await assign(tx, ctxB.tenantId, unit, rental, inDays(-2), 'active');
    });
  });

  // By marker, not by the ids above, so a run that died before this still
  // gets swept by the next. The app role cannot delete equipment, so this
  // runs on the direct (owner) connection, bounded to QA23 rows.
  afterAll(async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    await sql.begin(async (tx) => {
      const siteRows = await tx`select s.id from project_sites s join addresses a on a.id = s.address_id where a.line1 = 'QA23 Rd'`;
      const siteIds = siteRows.map((r) => r.id as string);
      if (siteIds.length) {
        await tx`delete from equipment_assignments where rental_id in (select id from rentals where project_site_id in ${tx(siteIds)})`;
        await tx`delete from rentals where project_site_id in ${tx(siteIds)}`;
        await tx`delete from project_sites where id in ${tx(siteIds)}`;
      }
      await tx`delete from equipment where serial_no like 'test-qa23-%'`;
      await tx`delete from addresses a where a.line1 = 'QA23 Rd' and not exists (select 1 from project_sites s where s.address_id = a.id)`;
    });
    await sql.end();
  });

  it('counts units on site, arriving within 14 days, and names the customer', async () => {
    const { items } = await listAll(ctxA);
    const byId = new Map(items.map((s) => [s.id, s]));

    const active = byId.get(ids.active)!;
    expect(active.activeUnits).toBe(2);
    expect(active.upcomingUnits).toBe(0);
    expect(active.customerName).toBe(customerNameA);

    const upcoming = byId.get(ids.upcoming)!;
    expect(upcoming.activeUnits).toBe(0);
    expect(upcoming.upcomingUnits).toBe(1);
    expect(new Date(upcoming.nextArrival!).getTime()).toBeCloseTo(inDays(3).getTime(), -5);
    expect(upcoming.customerName).toBeNull();

    const idle = byId.get(ids.idle)!;
    expect([idle.activeUnits, idle.upcomingUnits, idle.nextArrival]).toEqual([0, 0, null]);

    // Deployed first, then arriving, then the rest.
    const rank = (s: SiteResponse) => (s.activeUnits > 0 ? 0 : s.upcomingUnits > 0 ? 1 : 2);
    const ranks = items.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('?deployment= filters, with a total that matches the filtered rows', async () => {
    for (const [filter, mine, notMine] of [
      ['active', ids.active, [ids.upcoming, ids.idle]],
      ['upcoming', ids.upcoming, [ids.active, ids.idle]],
      ['idle', ids.idle, [ids.active, ids.upcoming]],
    ] as const) {
      const { items, total } = await listAll(ctxA, filter);
      expect(total).toBe(items.length);
      const found = new Set(items.map((s) => s.id));
      expect(found.has(mine)).toBe(true);
      for (const id of notMine) expect(found.has(id)).toBe(false);
    }
  });

  it("never lists another tenant's site", async () => {
    for (const filter of [undefined, 'active', 'upcoming', 'idle'] as const) {
      const { items } = await listAll(ctxA, filter);
      expect(items.some((s) => s.id === ids.foreign)).toBe(false);
    }
    const { items: fromB } = await listAll(ctxB);
    expect(fromB.some((s) => s.id === ids.foreign)).toBe(true);
    expect(fromB.some((s) => [ids.active, ids.upcoming, ids.idle].includes(s.id))).toBe(false);
  });
});
