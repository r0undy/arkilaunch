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
  const platformAdminRoleId = roleIds.get('platform_admin');
  if (!adminRoleId) throw new Error('admin role missing from seeded catalog');
  if (!timekeeperRoleId) throw new Error('timekeeper role missing from seeded catalog');
  if (!platformAdminRoleId) throw new Error('platform_admin role missing from seeded catalog');

  // Phase 2 (S25 Platform Console): platform_admin is RFC-1's reserved
  // cross-tenant role. It needs SOME tenant row to satisfy users.tenant_id
  // NOT NULL, even though its authority is cross-tenant via withPlatformTx,
  // never via this tenant's own RLS scope. A dedicated "platform" tenant
  // (not Almara) keeps that distinction visible rather than overloading the
  // anchor tenant with a role that doesn't belong to it.
  const [platformTenant] = await db
    .insert(schema.tenants)
    .values({
      legalName: 'ArkiLaunch Platform',
      slug: 'arkilaunch-platform',
      status: 'active',
      kycState: 'verified',
    })
    .onConflictDoUpdate({ target: schema.tenants.slug, set: { status: 'active' } })
    .returning();
  if (!platformTenant) throw new Error('failed to seed the platform tenant');

  const platformPasswordHash = await hash('changeme-dev-only');
  await db
    .insert(schema.users)
    .values({
      tenantId: platformTenant.id,
      roleId: platformAdminRoleId,
      email: 'platform-admin@arkilaunch.test',
      passwordHash: platformPasswordHash,
      status: 'active',
    })
    .onConflictDoNothing();

  // Phase 2 approval needs a plan to attach to the trialing subscription it
  // creates; subscription_plans has no other writer anywhere in the codebase.
  await db
    .insert(schema.subscriptionPlans)
    .values([
      { code: 'starter', name: 'Starter', limits: { equipmentUnits: 10, users: 5 } },
      { code: 'growth', name: 'Growth', limits: { equipmentUnits: 50, users: 20 } },
    ])
    .onConflictDoNothing();

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

  // ---- Expanded demo dataset ----
  // The block above seeds the single POC unit the sample-ID printout at the
  // bottom depends on; everything below adds enough breadth (every fleet
  // status, every EDTR/reconciliation state, the full PAGASA scale, etc.) for
  // the console UI to look like a real yard instead of an empty one. Guarded
  // on equipmentTypes count so re-running the seed does not duplicate rows.
  const allTypes = await db.select().from(schema.equipmentTypes);
  if (allTypes.length < 8) {
    const EXTRA_TYPE_NAMES = [
      'Excavator',
      'Bulldozer',
      'Boom Lift',
      'Wheel Loader',
      'Dump Truck',
      'Road Roller',
      'Generator Set',
    ];
    for (const name of EXTRA_TYPE_NAMES) {
      await db.insert(schema.equipmentTypes).values({ name }).onConflictDoNothing();
    }
  }
  const equipmentTypes = await db.select().from(schema.equipmentTypes);
  const typeByName = new Map(equipmentTypes.map((t) => [t.name, t]));

  // Rate cards for every type not yet priced.
  for (const t of equipmentTypes) {
    const existing = await db
      .select()
      .from(schema.rateCards)
      .where(eq(schema.rateCards.equipmentTypeId, t.id));
    if (existing.length === 0) {
      await db.insert(schema.rateCards).values({
        tenantId: tenant.id,
        equipmentTypeId: t.id,
        rateType: 'hourly',
        rateValue: (600 + Math.round(Math.random() * 1200)).toFixed(2),
        currency: 'PHP',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
    }
  }

  // Fleet: spread additional units across every availability_status with
  // realistic serials and runtime hours.
  const FLEET_PLAN: { type: string; model: string; serial: string; status: string; hours: string }[] = [
    { type: 'Excavator', model: 'Komatsu PC200', serial: 'almara-serial-002', status: 'available', hours: '1420.50' },
    { type: 'Excavator', model: 'CAT 320D', serial: 'almara-serial-003', status: 'deployed', hours: '3105.00' },
    { type: 'Bulldozer', model: 'Komatsu D65PX', serial: 'almara-serial-004', status: 'available', hours: '860.25' },
    { type: 'Bulldozer', model: 'CAT D6R', serial: 'almara-serial-005', status: 'maintenance', hours: '4210.75' },
    { type: 'Boom Lift', model: 'Genie S-60', serial: 'almara-serial-006', status: 'deployed', hours: '540.00' },
    { type: 'Boom Lift', model: 'JLG 660SJ', serial: 'almara-serial-007', status: 'available', hours: '120.50' },
    { type: 'Wheel Loader', model: 'Komatsu WA200', serial: 'almara-serial-008', status: 'available', hours: '2015.00' },
    { type: 'Wheel Loader', model: 'CAT 950M', serial: 'almara-serial-009', status: 'deployed', hours: '1690.25' },
    { type: 'Dump Truck', model: 'Isuzu FVZ', serial: 'almara-serial-010', status: 'available', hours: '980.00' },
    { type: 'Dump Truck', model: 'Hino 500', serial: 'almara-serial-011', status: 'maintenance', hours: '5320.50' },
    { type: 'Road Roller', model: 'Bomag BW213', serial: 'almara-serial-012', status: 'available', hours: '310.00' },
    { type: 'Road Roller', model: 'Sakai SW800', serial: 'almara-serial-013', status: 'deployed', hours: '75.50' },
    { type: 'Generator Set', model: 'Cummins C150D5', serial: 'almara-serial-014', status: 'available', hours: '2200.00' },
    { type: 'Generator Set', model: 'Perkins P220', serial: 'almara-serial-015', status: 'available', hours: '1100.25' },
    { type: 'Backhoe Loader', model: 'JCB 3CX', serial: 'almara-serial-016', status: 'deployed', hours: '2750.75' },
    { type: 'Backhoe Loader', model: 'Case 580N', serial: 'almara-serial-017', status: 'maintenance', hours: '6100.00' },
    { type: 'Excavator', model: 'Hitachi ZX130', serial: 'almara-serial-018', status: 'available', hours: '95.00' },
    { type: 'Wheel Loader', model: 'Volvo L60H', serial: 'almara-serial-019', status: 'available', hours: '1580.50' },
    { type: 'Boom Lift', model: 'Skyjack SJ86', serial: 'almara-serial-020', status: 'available', hours: '410.00' },
    { type: 'Dump Truck', model: 'Fuso FN', serial: 'almara-serial-021', status: 'available', hours: '660.25' },
    { type: 'Road Roller', model: 'Dynapac CA25', serial: 'almara-serial-022', status: 'maintenance', hours: '3890.00' },
    { type: 'Generator Set', model: 'Kohler KD220', serial: 'almara-serial-023', status: 'deployed', hours: '450.75' },
  ];

  const seededEquipment: (typeof schema.equipment.$inferSelect)[] = [equipmentRow];
  for (const plan of FLEET_PLAN) {
    const existing = await db.select().from(schema.equipment).where(eq(schema.equipment.serialNo, plan.serial));
    if (existing[0]) {
      seededEquipment.push(existing[0]);
      continue;
    }
    const type = typeByName.get(plan.type);
    if (!type) continue;
    const [row] = await db
      .insert(schema.equipment)
      .values({
        tenantId: tenant.id,
        equipmentTypeId: type.id,
        model: plan.model,
        serialNo: plan.serial,
        availabilityStatus: plan.status,
        runtimeHours: plan.hours,
      })
      .returning();
    if (row) seededEquipment.push(row);

    if (row) {
      await db.insert(schema.maintenanceSchedules).values({
        tenantId: tenant.id,
        equipmentId: row.id,
        hoursInterval: '250.00',
        nextDue: plan.status === 'maintenance' ? '0.00' : '250.00',
      });
      if (plan.status === 'maintenance') {
        await db.insert(schema.maintenanceLogs).values({
          tenantId: tenant.id,
          equipmentId: row.id,
          performedAt: new Date(Date.now() - 3 * 86400_000),
          notes: 'Scheduled 250-hour service; unit held pending parts.',
        });
      }
    }
  }

  // Project sites across real Luzon coordinates, each with its own address
  // and a weather_alerts row spanning the full PAGASA scale plus one stale
  // cached reading.
  // severity values must match WeatherSeveritySchema ('none' | 'watch' |
  // 'warning' -- packages/shared/src/weather-port.ts), which is what
  // sites.service.ts casts this column to on the read path.
  const SITE_PLAN: {
    line1: string;
    city: string;
    province: string;
    lat: string;
    lon: string;
    severity: string;
    stale: boolean;
  }[] = [
    { line1: '1 Sample Site Rd', city: 'Quezon City', province: 'Metro Manila', lat: '14.676000', lon: '121.043700', severity: 'none', stale: false },
    { line1: '88 Marikina Riverbank Rd', city: 'Marikina', province: 'Metro Manila', lat: '14.650000', lon: '121.101900', severity: 'watch', stale: false },
    { line1: '45 Los Baños Access Rd', city: 'Los Baños', province: 'Laguna', lat: '14.170600', lon: '121.241700', severity: 'watch', stale: false },
    { line1: '12 Tuguegarao Bypass', city: 'Tuguegarao', province: 'Cagayan', lat: '17.613300', lon: '121.727100', severity: 'warning', stale: false },
    { line1: '9 Batangas Port Access', city: 'Batangas City', province: 'Batangas', lat: '13.756300', lon: '121.058900', severity: 'none', stale: true },
  ];

  const seededSites: (typeof schema.projectSites.$inferSelect)[] = [site];
  for (const plan of SITE_PLAN.slice(1)) {
    const existing = await db.select().from(schema.addresses).where(eq(schema.addresses.line1, plan.line1));
    let addr = existing[0];
    if (!addr) {
      const [row] = await db
        .insert(schema.addresses)
        .values({ tenantId: tenant.id, line1: plan.line1, city: plan.city, province: plan.province, country: 'PH' })
        .returning();
      addr = row;
    }
    if (!addr) continue;

    const existingSites = await db.select().from(schema.projectSites).where(eq(schema.projectSites.addressId, addr.id));
    let siteRow = existingSites[0];
    if (!siteRow) {
      const [row] = await db
        .insert(schema.projectSites)
        .values({ tenantId: tenant.id, addressId: addr.id, latitude: plan.lat, longitude: plan.lon })
        .returning();
      siteRow = row;
    }
    if (siteRow) seededSites.push(siteRow);
  }

  for (let i = 0; i < SITE_PLAN.length; i += 1) {
    const plan = SITE_PLAN[i];
    const siteRow = seededSites[i];
    if (!plan || !siteRow) continue;
    const existingAlert = await db
      .select()
      .from(schema.weatherAlerts)
      .where(eq(schema.weatherAlerts.projectSiteId, siteRow.id));
    if (existingAlert.length === 0) {
      await db.insert(schema.weatherAlerts).values({
        tenantId: tenant.id,
        projectSiteId: siteRow.id,
        severity: plan.severity,
        observed: { source: 'open-meteo', rainfallMm: plan.severity === 'warning' ? 42 : plan.severity === 'watch' ? 20 : 5 },
        isStale: plan.stale,
        effectiveAt: new Date(),
        status: 'active',
      });
    }
  }

  // Customers, each with a contact, a billing address, and a rental.
  const CUSTOMER_PLAN = [
    { name: 'Almara Sample Customer Co.', existing: customerRow },
    { name: 'Bataan Infra Builders Inc.' },
    { name: 'Cavite Groundworks Corp.' },
    { name: 'Davao Earthmoving Ltd.' },
    { name: 'Iloilo Site Services Co.' },
    { name: 'Pampanga Roadworks Inc.' },
  ];
  const seededCustomers: (typeof schema.customers.$inferSelect)[] = [];
  for (const plan of CUSTOMER_PLAN) {
    if ('existing' in plan && plan.existing) {
      seededCustomers.push(plan.existing);
      continue;
    }
    const existing = await db.select().from(schema.customers).where(eq(schema.customers.companyName, plan.name));
    if (existing[0]) {
      seededCustomers.push(existing[0]);
      continue;
    }
    const [row] = await db.insert(schema.customers).values({ tenantId: tenant.id, companyName: plan.name }).returning();
    if (row) {
      seededCustomers.push(row);
      await db.insert(schema.customerContacts).values({
        tenantId: tenant.id,
        customerId: row.id,
        contactType: 'email',
        contactValue: `billing@${row.companyName.toLowerCase().replace(/[^a-z]+/g, '-')}.ph`,
        isPrimary: 'true',
      });
    }
  }

  const RENTAL_STATUSES = ['draft', 'active', 'active', 'active', 'completed', 'cancelled'];
  const seededRentals: (typeof schema.rentals.$inferSelect)[] = [rental];
  for (let i = 1; i < seededCustomers.length; i += 1) {
    const customer = seededCustomers[i];
    const siteRow = seededSites[i % seededSites.length];
    if (!customer || !siteRow) continue;
    const existing = await db.select().from(schema.rentals).where(eq(schema.rentals.customerId, customer.id));
    if (existing[0]) {
      seededRentals.push(existing[0]);
      continue;
    }
    const [row] = await db
      .insert(schema.rentals)
      .values({
        tenantId: tenant.id,
        customerId: customer.id,
        projectSiteId: siteRow.id,
        status: RENTAL_STATUSES[i] ?? 'active',
        startDate: new Date(Date.now() - (30 - i) * 86400_000),
      })
      .returning();
    if (row) seededRentals.push(row);
  }

  // Quotations: one plain quote, one revision chain, one stale-priced quote.
  const [dieselReading] = await db.select().from(schema.dieselPriceReadings).limit(1);
  if (rateCard && seededCustomers[0] && dieselReading) {
    const existingQuote = await db.select().from(schema.quotations).where(eq(schema.quotations.tenantId, tenant.id));
    if (existingQuote.length === 0) {
      const [q1] = await db
        .insert(schema.quotations)
        .values({
          tenantId: tenant.id,
          customerId: seededCustomers[0].id,
          rentalId: seededRentals[0]?.id,
          revision: 1,
          status: 'superseded',
          dieselPriceSnapshot: dieselReading.pricePhp,
          priceStale: 'false',
          dieselPriceReadingId: dieselReading.id,
          dieselPriceDate: dieselReading.observedDate,
          dieselPriceSource: dieselReading.source,
          subtotalPhp: '10200.00',
          totalPhp: '10200.00',
        })
        .returning();
      if (q1) {
        await db.insert(schema.quotations).values({
          tenantId: tenant.id,
          customerId: seededCustomers[0].id,
          rentalId: seededRentals[0]?.id,
          revision: 2,
          status: 'approved',
          parentQuotationId: q1.id,
          dieselPriceSnapshot: dieselReading.pricePhp,
          priceStale: 'false',
          dieselPriceReadingId: dieselReading.id,
          dieselPriceDate: dieselReading.observedDate,
          dieselPriceSource: dieselReading.source,
          subtotalPhp: '11500.00',
          totalPhp: '11500.00',
        });
        await db.insert(schema.quotationItems).values({
          tenantId: tenant.id,
          quotationId: q1.id,
          equipmentTypeId: resolvedEquipmentType.id,
          rateCardId: rateCard.id,
          quantity: 1,
          estimatedHours: '8.00',
          hourlyRatePhp: rateCard.rateValue,
          subtotalPhp: '6800.00',
        });
      }
      if (seededCustomers[1]) {
        await db.insert(schema.quotations).values({
          tenantId: tenant.id,
          customerId: seededCustomers[1].id,
          revision: 1,
          status: 'sent',
          dieselPriceSnapshot: dieselReading.pricePhp,
          priceStale: 'true',
          dieselPriceReadingId: dieselReading.id,
          dieselPriceDate: dieselReading.observedDate,
          dieselPriceSource: dieselReading.source,
          subtotalPhp: '7300.00',
          totalPhp: '7300.00',
        });
      }
    }
  }

  // EDTR rows across every status, plus reconciliations covering matched,
  // discrepancy (the Hazard Divider / blocked-deduction case), and approved.
  const EDTR_PLAN: { status: string; source: string; hoursActive: string; hoursIdle: string; recon?: { status: string; delta: string } }[] = [
    { status: 'queued', source: 'paper_ocr', hoursActive: '0', hoursIdle: '0' },
    { status: 'extracting', source: 'paper_ocr', hoursActive: '0', hoursIdle: '0' },
    { status: 'extracted', source: 'paper_ocr', hoursActive: '7.5', hoursIdle: '0.5' },
    { status: 'review', source: 'paper_ocr', hoursActive: '8.0', hoursIdle: '1.0', recon: { status: 'discrepancy', delta: '1.50' } },
    { status: 'reconciled', source: 'digital_entry', hoursActive: '8.0', hoursIdle: '0.0', recon: { status: 'matched', delta: '0.00' } },
    { status: 'reconciled', source: 'digital_entry', hoursActive: '6.5', hoursIdle: '1.5', recon: { status: 'approved', delta: '0.10' } },
    { status: 'hard_failed', source: 'paper_ocr', hoursActive: '0', hoursIdle: '0' },
  ];
  const existingEdtr = await db.select().from(schema.edtr).where(eq(schema.edtr.tenantId, tenant.id));
  if (existingEdtr.length === 0 && seededRentals[0]) {
    for (const plan of EDTR_PLAN) {
      const [row] = await db
        .insert(schema.edtr)
        .values({
          tenantId: tenant.id,
          rentalId: seededRentals[0].id,
          equipmentId: equipmentRow.id,
          source: plan.source,
          reportDate: new Date().toISOString().slice(0, 10),
          status: plan.status,
        })
        .returning();
      if (!row) continue;
      await db.insert(schema.edtrLineItems).values({
        tenantId: tenant.id,
        edtrId: row.id,
        hoursActive: plan.hoursActive,
        hoursIdle: plan.hoursIdle,
      });
      if (plan.recon) {
        await db.insert(schema.edtrReconciliations).values({
          tenantId: tenant.id,
          edtrId: row.id,
          deltaHours: plan.recon.delta,
          tolerance: '0.50',
          status: plan.recon.status,
        });
      }
    }
  }

  // Invoices + line items + payments across type and status.
  const existingInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, tenant.id));
  if (existingInvoices.length === 0 && seededRentals[0]) {
    const INVOICE_PLAN: { type: string; amount: string; status: string; payMethod?: string; payStatus?: string }[] = [
      { type: 'weekly', amount: '15200.00', status: 'paid', payMethod: 'gcash', payStatus: 'paid' },
      { type: 'deposit_deduction', amount: '3400.00', status: 'issued', payMethod: 'bank', payStatus: 'pending' },
      { type: 'final', amount: '48000.00', status: 'draft' },
    ];
    for (const plan of INVOICE_PLAN) {
      const [inv] = await db
        .insert(schema.invoices)
        .values({
          tenantId: tenant.id,
          rentalId: seededRentals[0].id,
          invoiceType: plan.type,
          amount: plan.amount,
          status: plan.status,
          dueDate: new Date(Date.now() + 14 * 86400_000),
        })
        .returning();
      if (!inv) continue;
      await db.insert(schema.invoiceLineItems).values({
        tenantId: tenant.id,
        invoiceId: inv.id,
        description: `${plan.type.replace('_', ' ')} charge`,
        quantity: '1',
        unitPrice: plan.amount,
        amount: plan.amount,
      });
      if (plan.payMethod) {
        await db.insert(schema.payments).values({
          tenantId: tenant.id,
          invoiceId: inv.id,
          method: plan.payMethod,
          amount: plan.amount,
          providerRef: `seed-${inv.id}`,
          status: plan.payStatus ?? 'pending',
        });
      }
    }
  }

  // Notifications for the app-bar badge.
  if (timekeeper) {
    const existingNotifications = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, timekeeper.id));
    if (existingNotifications.length === 0) {
      await db.insert(schema.notifications).values([
        { tenantId: tenant.id, userId: timekeeper.id, notificationType: 'weather_advisory', payload: { severity: 'orange' } },
        { tenantId: tenant.id, userId: timekeeper.id, notificationType: 'edtr_review', payload: { count: 1 } },
      ]);
    }
  }

  // 30 days of diesel price history so the staleness/date labelling has
  // something to show beyond a single reading.
  const existingHistory = await db.select().from(schema.dieselPriceReadings);
  if (existingHistory.length < 5) {
    const base = 61.45;
    for (let d = 30; d >= 1; d -= 5) {
      const day = new Date(Date.now() - d * 86400_000);
      await db
        .insert(schema.dieselPriceReadings)
        .values({
          region: 'NCR',
          pricePhp: (base + (Math.random() - 0.5) * 3).toFixed(2),
          observedDate: day.toISOString().slice(0, 10),
          source: 'doe_scrape',
        })
        .onConflictDoNothing();
    }
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
