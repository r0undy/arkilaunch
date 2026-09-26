import { describe, expect, it, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { and, eq, sql } from 'drizzle-orm';
import {
  addresses,
  edtr,
  edtrLineItems,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  evaluateSiteEquipment,
  events,
  flagUsedDespiteWarning,
  notifications,
  projectSites,
  rentals,
  warnOnEquipmentEscalation,
} from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';

// CR pricebook-kyc-weather: each machine on a site gets its own PAGASA-style
// level; rising to Caution/Stop work warns the customer, and hours logged on
// a machine warned to stop that day land in the incident log. A dedicated
// site with a crane and a roller side by side, so the two classes can be
// told apart on one reading.
describe('per-equipment weather (warning -> used despite warning)', () => {
  let tenantId: string;
  let siteId: string;
  let rentalId: string;
  let craneId: string;
  let rollerId: string;
  const province = `Test Province ${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const client = postgres(url, { max: 1 });
    const [tenant] = await client`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [customer] = await client`select id from customers where tenant_id = ${tenantId} and user_id is not null limit 1`;
    await client.end();

    const { db, client: jobClient } = makeJobDb();
    const typeId = async (name: string) => (await db.select().from(equipmentTypes).where(eq(equipmentTypes.name, name)).limit(1))[0]!.id;
    const [address] = await db.insert(addresses).values({ tenantId, line1: 'Wx Rd', city: 'Pasig', province, country: 'PH' }).returning();
    const [site] = await db.insert(projectSites).values({ tenantId, addressId: address!.id, latitude: '14.58', longitude: '121.06' }).returning();
    siteId = site!.id;
    const [rental] = await db
      .insert(rentals)
      .values({ tenantId, customerId: (customer as { id: string }).id, projectSiteId: siteId, status: 'active', startDate: new Date('2020-01-01T00:00:00Z') })
      .returning();
    rentalId = rental!.id;
    const unit = async (type: string, model: string) => {
      const [row] = await db
        .insert(equipment)
        .values({ tenantId, equipmentTypeId: await typeId(type), model, serialNo: `WX-${randomUUID().slice(0, 8)}` })
        .returning();
      await db.insert(equipmentAssignments).values({ tenantId, equipmentId: row!.id, rentalId, start: new Date('2020-01-01T00:00:00Z'), status: 'active' });
      return row!.id;
    };
    craneId = await unit('Crane', 'Test 50t Crane');
    rollerId = await unit('Road Roller', 'Test Roller');
    await jobClient.end();
  });

  it('judges each machine on its own: gusts stop the crane; the roller is only limited', async () => {
    const { db, client } = makeJobDb();
    const levels = await evaluateSiteEquipment(db, tenantId, siteId, { tempC: 30, windKph: 30, gustKph: 55, precipMm: 0, code: 2, humidityPct: 60 });
    await client.end();
    expect(levels.equipment.find((m) => m.equipmentId === craneId)?.level).toBe('stop_work');
    // 55 km/h gusts also read as a PAGASA Signal No. 1 (39-61 km/h): that
    // limits a roller (Caution) but stops lifting outright.
    expect(levels.equipment.find((m) => m.equipmentId === rollerId)?.level).toBe('caution');
    expect(levels.level).toBe('stop_work');
  });

  it('estimates the PAGASA-equivalent signal and rainfall from the live reading', async () => {
    const { db, client } = makeJobDb();
    const levels = await evaluateSiteEquipment(db, tenantId, siteId, { tempC: 28, windKph: 45, precipMm: 35, code: 1 });
    await client.end();
    expect(levels.pagasa).toMatchObject({ tcws: 1, rainfall: 'red' });
    expect(levels.equipment.find((m) => m.equipmentId === rollerId)?.level).toBe('stop_work');
  });

  it('warns once on the rise, then logs hours on the stopped machine as used despite the warning', async () => {
    const { db, client } = makeJobDb();
    try {
      const levels = await evaluateSiteEquipment(db, tenantId, siteId, { tempC: 30, windKph: 30, gustKph: 55, precipMm: 0, code: 2 });
      expect(await warnOnEquipmentEscalation(db, tenantId, siteId, null, levels.equipment)).toBeGreaterThan(0);
      // Still stopped next poll: no second warning.
      expect(await warnOnEquipmentEscalation(db, tenantId, siteId, levels.equipment, levels.equipment)).toBe(0);
      const [warned] = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.notificationType, 'equipment_weather_warning'), sql`${notifications.payload} ->> 'equipment_id' = ${craneId}`))
        .limit(1);
      expect(warned).toBeDefined();

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const [row] = await db.insert(edtr).values({ tenantId, rentalId, equipmentId: craneId, source: 'digital_entry', reportDate: today, status: 'extracted' }).returning();
      await db.insert(edtrLineItems).values({ tenantId, edtrId: row!.id, hoursActive: '6' });
      expect(await flagUsedDespiteWarning(db, tenantId, row!.id)).toBe(true);
      // Once per EDTR.
      expect(await flagUsedDespiteWarning(db, tenantId, row!.id)).toBe(false);
      const [incident] = await db
        .select()
        .from(events)
        .where(and(eq(events.name, 'equipment_used_despite_warning'), sql`${events.properties} ->> 'edtr_id' = ${row!.id}`))
        .limit(1);
      expect(incident?.properties).toMatchObject({ equipment_id: craneId, level: 'stop_work', hours_active: 6 });
    } finally {
      await client.end();
    }
  });
});
