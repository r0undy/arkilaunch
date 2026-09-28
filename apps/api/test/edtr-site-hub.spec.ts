import { describe, expect, it, beforeAll } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  addresses,
  equipment as equipmentTable,
  equipmentAssignments,
  invoiceLineItems,
  invoices,
  projectSites,
  quotations,
  rateCards,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';
import { SiteHubService } from '../src/sites/site-hub.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import type { QuotesService } from '../src/quotes/quotes.service.js';
import { ensurePaidDeposit } from './paid-deposit.js';

// cr-arkilaunch-edtr-site-hub-approval.md: the rental-span rule, hour
// categories, and approval from the site hub through the office log. The
// site, rental, unit and assignment are dedicated to this file so the
// shared fixtures other specs mutate cannot interfere.
describe('EDTR site hub approval', () => {
  const events = new EventsService();
  const edtr = new EdtrService(events);
  const hubs = new SiteHubService(events);
  let adminCtx: RequestContext;
  let siteId: string;
  let rentalId: string;
  let rentalCode: string;
  let equipmentId: string;
  let assignmentId: string;

  // The unit is on site 2022-05-02 .. 2022-05-06 (Asia/Manila).
  const START = new Date('2022-05-02T00:00:00+08:00');
  const END = new Date('2022-05-06T17:00:00+08:00');

  beforeAll(async () => {
    delete process.env.ENABLE_OCR_PIPELINE;
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    const [card] =
      await sql`select equipment_type_id from rate_cards where tenant_id = ${tenantId} and rate_type = 'hourly' limit 1`;
    await sql.end();
    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };

    await withTenantTx(adminCtx, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId, line1: 'Site Hub Spec Rd', city: 'Pasig', province: 'Metro Manila', country: 'PH' })
        .returning();
      const [site] = await tx
        .insert(projectSites)
        .values({ tenantId, addressId: address!.id, latitude: '14.576000', longitude: '121.085000' })
        .returning();
      siteId = site!.id;
      const [unit] = await tx
        .insert(equipmentTable)
        .values({
          tenantId,
          equipmentTypeId: (card as { equipment_type_id: string }).equipment_type_id,
          model: 'Site Hub Spec Unit',
          serialNo: `site-hub-${Date.now()}`,
        })
        .returning();
      equipmentId = unit!.id;
      // A unit-level card (it overrides the type's) in force for the whole
      // test span, so the priced approval does not depend on the shared
      // type cards other specs supersede.
      await tx.insert(rateCards).values({
        tenantId,
        equipmentTypeId: (card as { equipment_type_id: string }).equipment_type_id,
        equipmentId,
        rateType: 'hourly',
        rateValue: '1000',
        effectiveFrom: new Date('2020-01-01T00:00:00+08:00'),
      });
      const [rental] = await tx
        .insert(rentals)
        .values({
          tenantId,
          customerId: (customer as { id: string }).id,
          projectSiteId: siteId,
          status: 'active',
          startDate: START,
          endDate: END,
          siteContact: 'Engr. Reyes',
        })
        .returning();
      rentalId = rental!.id;
      rentalCode = rental!.code;
      const [assignment] = await tx
        .insert(equipmentAssignments)
        .values({ tenantId, equipmentId, rentalId, start: START, end: END, status: 'active' })
        .returning();
      assignmentId = assignment!.id;
      const [quotation] = await tx
        .insert(quotations)
        .values({ tenantId, customerId: (customer as { id: string }).id, rentalId })
        .returning();
      await tx.insert(rentalContracts).values({ tenantId, quotationId: quotation!.id, depositRequired: '100000000.00' });
    });
    await ensurePaidDeposit(adminCtx, rentalId);
  });

  const submit = (reportDate: string, lineItems: Record<string, unknown>) =>
    edtr.capture(adminCtx, {
      source: 'paper_ocr',
      rentalId,
      equipmentId,
      reportDate,
      rawFileUri: 'storage://fixtures/site-hub.jpg',
      lineItems: lineItems as { hoursActive: number; hoursIdle: number },
    });

  it('refuses a report date outside the unit span, and accepts one inside it', async () => {
    await expect(submit('2022-05-01', { hoursActive: 8, hoursIdle: 0 })).rejects.toThrow(BadRequestException);
    await expect(submit('2022-05-07', { hoursActive: 8, hoursIdle: 0 })).rejects.toThrow(BadRequestException);
    const inside = await submit('2022-05-02', { hoursActive: 8, hoursIdle: 0 });
    expect(inside.status).toBe('review');
  });

  it('widens with an approved extension: the span is read live', async () => {
    await withTenantTx(adminCtx, (tx) =>
      tx
        .update(equipmentAssignments)
        .set({ end: new Date('2022-05-08T17:00:00+08:00') })
        .where(eq(equipmentAssignments.id, assignmentId)),
    );
    const extended = await submit('2022-05-07', { hoursActive: 4, hoursIdle: 0 });
    expect(extended.id).toBeTruthy();
  });

  it('approves from the hub: office log pairs, billable = running + idle, downtime unbilled, meter gets running', async () => {
    const day = await submit('2022-05-03', {
      hoursActive: 6,
      hoursIdle: 1,
      hoursBreakdown: 2,
      hoursWeather: 0,
      hoursOtherDowntime: 0,
      hoursTotal: 9,
    });
    const [before] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(equipmentTable).where(eq(equipmentTable.id, equipmentId)),
    );
    const result = await edtr.review(adminCtx, day.id, {
      decision: 'approve',
      hours: { hoursActive: 6, hoursIdle: 1, hoursBreakdown: 2, hoursWeather: 0, hoursOtherDowntime: 0, hoursTotal: 9 },
    });
    expect('invoiceLine' in result && result.invoiceLine.hours).toBe(7);

    const [after] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(equipmentTable).where(eq(equipmentTable.id, equipmentId)),
    );
    expect(Number(after!.runtimeHours) - Number(before!.runtimeHours)).toBe(6);

    const lines = await withTenantTx(adminCtx, (tx) =>
      tx
        .select({ description: invoiceLineItems.description })
        .from(invoiceLineItems)
        .innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
        .where(eq(invoices.rentalId, rentalId)),
    );
    expect(lines.some((l) => l.description.startsWith(`${rentalCode} · Site Hub Spec Unit · 2022-05-03`))).toBe(true);

    await expect(
      edtr.review(adminCtx, day.id, { decision: 'approve', hours: { hoursActive: 6, hoursIdle: 1 } }),
    ).rejects.toThrow(ConflictException);

    const hub = await hubs.hub(adminCtx, siteId);
    const cell = hub.days.find((d) => d.date === '2022-05-03' && d.equipmentId === equipmentId);
    expect(cell?.status).toBe('approved');
    expect(cell?.hours).toMatchObject({ running: 6, billable: 7, breakdown: 2 });
    expect(hub.personnel.siteReps).toEqual([{ name: 'Engr. Reyes', bookingCode: rentalCode }]);

    const bookings = new BookingsService(events, { autoQuoteBooking: async () => null } as unknown as QuotesService);
    const booking = await bookings.get(adminCtx, rentalId);
    expect(booking.fieldLogs?.days.some((d) => d.date === '2022-05-03' && d.hours.billable === 7)).toBe(true);
  });

  it('a correction request shows as needs_correction until the timekeeper resubmits', async () => {
    const day = await submit('2022-05-04', { hoursActive: 8, hoursIdle: 0 });
    await edtr.review(adminCtx, day.id, { decision: 'needs_correction', reason: 'Meter reading missing' });
    let hub = await hubs.hub(adminCtx, siteId);
    expect(hub.days.find((d) => d.date === '2022-05-04')?.status).toBe('needs_correction');

    await submit('2022-05-04', { hoursActive: 8, hoursIdle: 0, hourMeterStart: 100, hourMeterEnd: 108 });
    hub = await hubs.hub(adminCtx, siteId);
    expect(hub.days.find((d) => d.date === '2022-05-04')?.status).toBe('pending');
  });

  it('flags a total that is not the sum of its parts', async () => {
    const day = await submit('2022-05-05', {
      hoursActive: 5,
      hoursIdle: 0,
      hoursBreakdown: 0,
      hoursWeather: 0,
      hoursOtherDowntime: 0,
      hoursTotal: 8,
    });
    const detail = await edtr.get(adminCtx, day.id);
    expect(detail.lineItems[0]?.reviewFlags).toContain('total_mismatch');
  });
});
