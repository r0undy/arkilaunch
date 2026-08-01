import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import * as schema from '../schema/index.js';
import { makeServiceDb, seedPermissionCatalog } from './permission-catalog.js';

// Loading dotenv happens in permission-catalog.js (imported above), which
// every seed entrypoint already imports.

// Seeds Almara Construction as the anchor tenant (PRD, README), plus enough
// sample operational data (equipment, a rate card, pricing parameters, a
// customer, and a rental) that the admin/timekeeper POC screens have real
// IDs to reference instead of requiring a hand-typed UUID guess. Idempotent.
async function main() {
  const { db, client } = makeServiceDb();
  const { roleIds } = await seedPermissionCatalog(db);

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      legalName: 'Almara Construction',
      slug: 'almara',
      status: 'active',
      kycState: 'verified',
    })
    .onConflictDoUpdate({ target: schema.tenants.slug, set: { status: 'active' } })
    .returning();
  if (!tenant) throw new Error('failed to seed the Almara tenant');

  const adminRoleId = roleIds.get('admin');
  const timekeeperRoleId = roleIds.get('timekeeper');
  if (!adminRoleId) throw new Error('admin role missing from seeded catalog');
  if (!timekeeperRoleId) throw new Error('timekeeper role missing from seeded catalog');

  const passwordHash = await hash('changeme-dev-only');
  await db
    .insert(schema.users)
    .values({ tenantId: tenant.id, roleId: adminRoleId, email: 'admin@almara.test', passwordHash, status: 'active' })
    .onConflictDoNothing();
  await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      roleId: timekeeperRoleId,
      email: 'timekeeper@almara.test',
      passwordHash,
      status: 'active',
    })
    .onConflictDoNothing();
  const [timekeeper] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, 'timekeeper@almara.test'));

  const [equipmentType] = await db
    .insert(schema.equipmentTypes)
    .values({ name: 'Backhoe Loader' })
    .onConflictDoNothing()
    .returning();
  const resolvedEquipmentType =
    equipmentType ??
    (await db.select().from(schema.equipmentTypes).where(eq(schema.equipmentTypes.name, 'Backhoe Loader')))[0];
  if (!resolvedEquipmentType) throw new Error('failed to seed equipment_types');

  await db
    .insert(schema.dieselPriceReadings)
    .values({
      region: 'NCR',
      pricePhp: '61.4500',
      observedDate: new Date().toISOString().slice(0, 10),
      source: 'doe_scrape',
    })
    .onConflictDoNothing();

  const existingEquipment = await db.select().from(schema.equipment).where(eq(schema.equipment.tenantId, tenant.id));
  const equipmentRow =
    existingEquipment[0] ??
    (
      await db
        .insert(schema.equipment)
        .values({
          tenantId: tenant.id,
          equipmentTypeId: resolvedEquipmentType.id,
          model: 'Almara Backhoe #1',
          serialNo: 'almara-serial-001',
        })
        .returning()
    )[0];
  if (!equipmentRow) throw new Error('failed to seed equipment for Almara');

  // PRD-F4: maintenance-schedule writes are out of scope for this pass
  // (fleet.service.ts only advances an existing row's next_due); seed one
  // per unit here so the PM cron and the maintenance-detail endpoint have
  // real data to work against.
  const existingSchedule = await db
    .select()
    .from(schema.maintenanceSchedules)
    .where(eq(schema.maintenanceSchedules.equipmentId, equipmentRow.id));
  if (existingSchedule.length === 0) {
    await db.insert(schema.maintenanceSchedules).values({
      tenantId: tenant.id,
      equipmentId: equipmentRow.id,
      hoursInterval: '250.00',
      nextDue: '250.00',
    });
  }

  const existingRateCard = await db.select().from(schema.rateCards).where(eq(schema.rateCards.tenantId, tenant.id));
  if (existingRateCard.length === 0) {
    await db.insert(schema.rateCards).values({
      tenantId: tenant.id,
      equipmentTypeId: resolvedEquipmentType.id,
      rateType: 'hourly',
      rateValue: '850.00',
      currency: 'PHP',
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    });
  }
  const [rateCard] = await db.select().from(schema.rateCards).where(eq(schema.rateCards.tenantId, tenant.id));

  const existingParams = await db
    .select()
    .from(schema.pricingParameters)
    .where(eq(schema.pricingParameters.tenantId, tenant.id));
  if (existingParams.length === 0) {
    await db.insert(schema.pricingParameters).values({
      tenantId: tenant.id,
      region: 'NCR',
      operatorHourlyPhp: '180.00',
      maintenanceHourlyPhp: '120.00',
      bufferPct: '0.10',
      fuelLPerHour: '14.000',
      fuelLPerKm: '0.350',
      transportPhpPerKm: '45.00',
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    });
  }

  const existingCustomer = await db.select().from(schema.customers).where(eq(schema.customers.tenantId, tenant.id));
  const customerRow =
    existingCustomer[0] ??
    (await db.insert(schema.customers).values({ tenantId: tenant.id, companyName: 'Almara Sample Customer Co.' }).returning())[0];
  if (!customerRow) throw new Error('failed to seed a customer for Almara');

  const existingAddress = await db.select().from(schema.addresses).where(eq(schema.addresses.tenantId, tenant.id));
  const address =
    existingAddress[0] ??
    (
      await db
        .insert(schema.addresses)
        .values({ tenantId: tenant.id, line1: '1 Sample Site Rd', city: 'Quezon City', province: 'Metro Manila', country: 'PH' })
        .returning()
    )[0];
  if (!address) throw new Error('failed to seed an address for Almara');

  const existingSite = await db.select().from(schema.projectSites).where(eq(schema.projectSites.tenantId, tenant.id));
  const site =
    existingSite[0] ??
    (
      await db
        .insert(schema.projectSites)
        .values({ tenantId: tenant.id, addressId: address.id, latitude: '14.676000', longitude: '121.043700' })
        .returning()
    )[0];
  if (!site) throw new Error('failed to seed a project site for Almara');

  const existingRental = await db.select().from(schema.rentals).where(eq(schema.rentals.tenantId, tenant.id));
  const rental =
    existingRental[0] ??
    (
      await db
        .insert(schema.rentals)
        .values({
          tenantId: tenant.id,
          customerId: customerRow.id,
          projectSiteId: site.id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning()
    )[0];
  if (!rental) throw new Error('failed to seed a rental for Almara');

  if (timekeeper) {
    await db
      .insert(schema.timekeeperSiteAssignments)
      .values({ tenantId: tenant.id, userId: timekeeper.id, projectSiteId: site.id })
      .onConflictDoNothing();
  }

  await client.end();
  console.log('Anchor tenant seeded: Almara Construction.');
  console.log('Sample IDs for the POC screens:');
  console.log(`  customerId:       ${customerRow.id}`);
  console.log(`  projectSiteId:    ${site.id}`);
  console.log(`  rentalId:         ${rental.id}`);
  console.log(`  equipmentId:      ${equipmentRow.id}`);
  console.log(`  equipmentTypeId:  ${resolvedEquipmentType.id}`);
  console.log(`  rateCardId:       ${rateCard?.id ?? '(none)'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
