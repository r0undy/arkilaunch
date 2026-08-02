import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { and, desc, eq } from 'drizzle-orm';
import { equipment, events, maintenanceSchedules, notifications, tenants } from '@arkilaunch/db';
import { runMaintenanceNotify } from './maintenance-notify.js';
import { makeJobDb } from './db-client.js';

// PRD-F4 (PM-threshold notification): dedup across repeated cron cycles,
// and A1 (a tenant with no active fleet:manage user is skipped, not given
// an invented recipient).
describe('maintenance-notify (PRD-F4)', () => {
  let tenantId: string;
  let adminUserId: string;
  let equipmentTypeId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    adminUserId = (admin as { id: string }).id;
    const [equipmentType] = await sql`select id from equipment_types limit 1`;
    equipmentTypeId = (equipmentType as { id: string }).id;
    await sql.end();
  });

  async function createDueUnit(tenant: string, serialSuffix: string): Promise<string> {
    const { db, client } = makeJobDb();
    const [unit] = await db
      .insert(equipment)
      .values({
        tenantId: tenant,
        equipmentTypeId,
        model: 'Notify Test Unit',
        serialNo: `notify-test-${Date.now()}-${serialSuffix}`,
      })
      .returning();
    // runtime_hours defaults to 0; next_due = 0 means already past threshold.
    await db.insert(maintenanceSchedules).values({
      tenantId: tenant,
      equipmentId: unit!.id,
      hoursInterval: '250.00',
      nextDue: '0.00',
    });
    await client.end();
    return unit!.id;
  }

  it('notifies every active fleet:manage user for a unit at or past its threshold', async () => {
    const equipmentId = await createDueUnit(tenantId, 'a');
    await runMaintenanceNotify();

    const { db, client } = makeJobDb();
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, adminUserId),
          eq(notifications.notificationType, 'maintenance_due'),
        ),
      );
    await client.end();

    const forThisUnit = rows.filter((row) => (row.payload as Record<string, unknown>).equipment_id === equipmentId);
    expect(forThisUnit.length).toBe(1);
  });

  it('does not re-notify for the same unchanged threshold on a second cron run', async () => {
    const equipmentId = await createDueUnit(tenantId, 'b');
    await runMaintenanceNotify();
    await runMaintenanceNotify();

    const { db, client } = makeJobDb();
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.notificationType, 'maintenance_due')));
    await client.end();

    const forThisUnit = rows.filter((row) => (row.payload as Record<string, unknown>).equipment_id === equipmentId);
    expect(forThisUnit.length).toBe(1); // deduped, not one row per cron cycle
  });

  // A1.
  it('A1: a tenant with no active fleet:manage user is skipped, not given an invented recipient', async () => {
    const { db, client } = makeJobDb();
    const [noRecipientTenant] = await db
      .insert(tenants)
      .values({ legalName: 'No Fleet Manager Co.', slug: `notify-test-no-recipient-${Date.now()}`, status: 'active' })
      .returning();
    await client.end();

    const equipmentId = await createDueUnit(noRecipientTenant!.id, 'c');
    await runMaintenanceNotify();

    const { db: db2, client: client2 } = makeJobDb();
    const notifRows = await db2.select().from(notifications).where(eq(notifications.tenantId, noRecipientTenant!.id));
    const [degradedEvent] = await db2
      .select()
      .from(events)
      .where(and(eq(events.tenantId, noRecipientTenant!.id), eq(events.name, 'external_dependency_degraded')))
      .orderBy(desc(events.occurredAt))
      .limit(1);
    await client2.end();

    expect(notifRows).toHaveLength(0);
    expect(degradedEvent).toBeTruthy();
    expect((degradedEvent!.properties as Record<string, unknown>).equipment_id).toBe(equipmentId);
  });
});
