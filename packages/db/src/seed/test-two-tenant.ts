import { hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import * as schema from '../schema/index.js';
import { makeServiceDb, seedPermissionCatalog } from './permission-catalog.js';

// QAD §3: "A test that 'confirms isolation' against a single-tenant
// database proves nothing." Seeds two tenants, each with an admin user,
// one piece of equipment, a rate card, pricing parameters, and a customer,
// so cross-tenant isolation tests (including the RFC-3 quotation engine's
// QAD-T48) have real rows on both sides of the boundary to probe.
async function main() {
  const { db, client } = makeServiceDb();
  const { roleIds } = await seedPermissionCatalog(db);
  const adminRoleId = roleIds.get('admin');
  const timekeeperRoleId = roleIds.get('timekeeper');
  if (!adminRoleId) throw new Error('admin role missing from seeded catalog');
  if (!timekeeperRoleId) throw new Error('timekeeper role missing from seeded catalog');

  const [equipmentType] = await db
    .insert(schema.equipmentTypes)
    .values({ name: 'Backhoe Loader' })
    .onConflictDoNothing()
    .returning();
  const resolvedEquipmentType =
    equipmentType ??
    (await db.select().from(schema.equipmentTypes).where(eq(schema.equipmentTypes.name, 'Backhoe Loader')))[0];
  if (!resolvedEquipmentType) throw new Error('failed to seed equipment_types');

  // Global diesel reading (RFC-3): one row is enough for both tenants'
  // pricing engine calls to resolve a fresh price.
  await db
    .insert(schema.dieselPriceReadings)
    .values({
      region: 'NCR',
      pricePhp: '61.4500',
      observedDate: new Date().toISOString().slice(0, 10),
      source: 'doe_scrape',
    })
    .onConflictDoNothing();

  for (const slug of ['test-tenant-a', 'test-tenant-b']) {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ legalName: `Test Tenant ${slug.slice(-1).toUpperCase()}`, slug, status: 'active' })
      .onConflictDoUpdate({ target: schema.tenants.slug, set: { status: 'active' } })
      .returning();
    if (!tenant) continue;

    const passwordHash = await hash('test-password');
    await db
      .insert(schema.users)
      .values({
        tenantId: tenant.id,
        roleId: adminRoleId,
        email: `admin@${slug}.test`,
        passwordHash,
        status: 'active',
      })
      .onConflictDoNothing();

    await db
      .insert(schema.equipment)
      .values({
        tenantId: tenant.id,
        equipmentTypeId: resolvedEquipmentType.id,
        model: `${slug} Excavator`,
        serialNo: `${slug}-serial-001`,
      })
      .onConflictDoNothing();

    const existingRateCard = await db
      .select()
      .from(schema.rateCards)
      .where(eq(schema.rateCards.tenantId, tenant.id));
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

    const existingCustomer = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.tenantId, tenant.id));
    if (existingCustomer.length === 0) {
      await db.insert(schema.customers).values({
        tenantId: tenant.id,
        companyName: `${slug} Customer Co.`,
      });
    }

    // Timekeeper user + an assigned site (RFC-2 §8 US-02 AC2: a timekeeper
    // may only submit/view an EDTR for a site they are assigned to).
    await db
      .insert(schema.users)
      .values({
        tenantId: tenant.id,
        roleId: timekeeperRoleId,
        email: `timekeeper@${slug}.test`,
        passwordHash,
        status: 'active',
      })
      .onConflictDoNothing();

    const existingAddress = await db
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.tenantId, tenant.id));
    const address =
      existingAddress[0] ??
      (
        await db
          .insert(schema.addresses)
          .values({
            tenantId: tenant.id,
            line1: '1 Test Site Rd',
            city: 'Quezon City',
            province: 'Metro Manila',
            country: 'PH',
          })
          .returning()
      )[0];
    if (!address) throw new Error(`failed to seed address for ${slug}`);

    const existingSite = await db
      .select()
      .from(schema.projectSites)
      .where(eq(schema.projectSites.tenantId, tenant.id));
    const site =
      existingSite[0] ??
      (
        await db
          .insert(schema.projectSites)
          .values({ tenantId: tenant.id, addressId: address.id, latitude: '14.676000', longitude: '121.043700' })
          .returning()
      )[0];
    if (!site) throw new Error(`failed to seed project_sites for ${slug}`);

    const [timekeeper] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenant.id), eq(schema.users.roleId, timekeeperRoleId)));
    if (timekeeper) {
      await db
        .insert(schema.timekeeperSiteAssignments)
        .values({ tenantId: tenant.id, userId: timekeeper.id, projectSiteId: site.id })
        .onConflictDoNothing();
    }

    // A rental (RFC-2 §3: edtr.rental_id FK) so EDTR fixtures have somewhere
    // to attach.
    const [customerRow] = await db.select().from(schema.customers).where(eq(schema.customers.tenantId, tenant.id));
    const existingRental = await db.select().from(schema.rentals).where(eq(schema.rentals.tenantId, tenant.id));
    if (existingRental.length === 0 && customerRow) {
      await db.insert(schema.rentals).values({
        tenantId: tenant.id,
        customerId: customerRow.id,
        projectSiteId: site.id,
        status: 'active',
        startDate: new Date('2020-01-01T00:00:00Z'),
      });
    }
  }

  await client.end();
  console.log('Two-tenant test fixture seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
