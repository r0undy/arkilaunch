import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import {
  edtrSheetDownloads,
  equipment,
  equipmentAssignments,
  notifications,
  projectSites,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import { FIELD_SHEET_DAILY_LIMIT, StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { EventsService } from '../src/events/events.service.js';
import { FieldSheetsService } from '../src/edtr/field-sheets.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { BillingService } from '../src/billing/billing.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';

// Needs migration 0074 and the two-tenant fixture (test-tenant-a / -b).
describe('Timekeeper EDTR sheet downloads', () => {
  const events = new EventsService();
  const sheets = new FieldSheetsService(events);
  const payments = new PaymentsService(new StubPaymentsAdapter(), events);
  const bookings = new BookingsService(events, new QuotesService(new PricingEngineService(), events), payments);
  const billing = new BillingService();
  let timekeeper: RequestContext;
  let admin: RequestContext;
  let otherTenantAdmin: RequestContext;
  let rentalId: string;
  let unitA: string;
  let unitB: string;
  let unassignedRentalId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const ctxFor = async (slug: string, role: string) => {
      const [row] = await sql`select u.id, u.tenant_id from users u join roles r on r.id = u.role_id join tenants t on t.id = u.tenant_id
        where t.slug = ${slug} and r.name = ${role} and u.status = 'active' limit 1`;
      const r = row as { id: string; tenant_id: string };
      return { tenantId: r.tenant_id, userId: r.id, role } as RequestContext;
    };
    timekeeper = await ctxFor('test-tenant-a', 'timekeeper');
    admin = await ctxFor('test-tenant-a', 'admin');
    otherTenantAdmin = await ctxFor('test-tenant-b', 'admin');
    await sql.end();

    // Fresh units each run, so today's counts start at zero.
    await withTenantTx(admin, async (tx) => {
      const [site] = await tx.select().from(projectSites).limit(1);
      const [rental] = await tx
        .select()
        .from(rentals)
        .where(and(eq(rentals.projectSiteId, site!.id), eq(rentals.status, 'active')))
        .limit(1);
      const [anyUnit] = await tx.select().from(equipment).limit(1);
      rentalId = rental!.id;
      const make = async (serial: string) => {
        const [u] = await tx
          .insert(equipment)
          .values({ tenantId: admin.tenantId, equipmentTypeId: anyUnit!.equipmentTypeId, model: 'Sheet test unit', serialNo: serial })
          .returning();
        await tx.insert(equipmentAssignments).values({
          tenantId: admin.tenantId,
          equipmentId: u!.id,
          rentalId,
          start: new Date(Date.now() - 86_400_000),
          status: 'active',
        });
        return u!.id;
      };
      const stamp = Date.now();
      unitA = await make(`sheet-a-${stamp}`);
      unitB = await make(`sheet-b-${stamp}`);
      // A site the timekeeper is not assigned to.
      const [lonely] = await tx
        .insert(projectSites)
        .values({ tenantId: admin.tenantId, addressId: site!.addressId, latitude: '14.600000', longitude: '121.000000' })
        .returning();
      const [other] = await tx
        .insert(rentals)
        .values({ tenantId: admin.tenantId, customerId: rental!.customerId, projectSiteId: lonely!.id, status: 'active', startDate: new Date() })
        .returning();
      unassignedRentalId = other!.id;
    });
  });

  it(`allows ${FIELD_SHEET_DAILY_LIMIT} downloads per unit per day, then refuses; another unit is unaffected`, async () => {
    for (let i = 0; i < FIELD_SHEET_DAILY_LIMIT; i++) {
      const res = await sheets.download(timekeeper, { rentalId, equipmentId: unitA });
      expect(res.remainingToday).toBe(FIELD_SHEET_DAILY_LIMIT - i - 1);
      expect(res.context.rentalId).toBe(rentalId);
    }
    await expect(sheets.download(timekeeper, { rentalId, equipmentId: unitA })).rejects.toMatchObject({
      response: { error: 'edtr_sheet_daily_limit' },
    });
    expect((await sheets.download(timekeeper, { rentalId, equipmentId: unitB })).remainingToday).toBe(FIELD_SHEET_DAILY_LIMIT - 1);

    const listed = await sheets.list(timekeeper);
    expect(listed.items.find((u) => u.equipmentId === unitA)?.remainingToday).toBe(0);
  });

  it('hides sheets of an unassigned site from a timekeeper, on both routes', async () => {
    await expect(sheets.download(timekeeper, { rentalId: unassignedRentalId, equipmentId: unitA })).rejects.toMatchObject({
      response: { error: 'booking_not_found' },
    });
    await expect(bookings.edtrSheet(timekeeper, unassignedRentalId)).rejects.toMatchObject({
      response: { error: 'booking_not_found' },
    });
    expect((await bookings.edtrSheet(timekeeper, rentalId)).rentalId).toBe(rentalId);
  });

  it('is a timekeeper-only route; the office prints from the booking without a limit', async () => {
    await expect(sheets.download(admin, { rentalId, equipmentId: unitA })).rejects.toMatchObject({ response: { error: 'timekeeper_only' } });
    for (let i = 0; i < FIELD_SHEET_DAILY_LIMIT + 1; i++) expect((await bookings.edtrSheet(admin, rentalId)).rentalId).toBe(rentalId);
  });

  it('keeps download rows inside their tenant', async () => {
    const seen = await withTenantTx(otherTenantAdmin, (tx) =>
      tx.select().from(edtrSheetDownloads).where(eq(edtrSheetDownloads.equipmentId, unitA)),
    );
    expect(seen).toHaveLength(0);
  });

  it('saves the company paper size', async () => {
    await sheets.saveSettings(admin, { paperSize: 'letter' });
    expect((await sheets.download(timekeeper, { rentalId, equipmentId: unitB })).page).toBe('letter');
    await sheets.saveSettings(admin, { paperSize: 'legal' });
  });

  it('completing a rental tells the office and the customer the statement is ready; the PDF renders', async () => {
    await withTenantTx(admin, (tx) => tx.update(rentals).set({ status: 'active' }).where(eq(rentals.id, unassignedRentalId)));
    await bookings.markReturned(admin, unassignedRentalId);
    const feed = await withTenantTx(admin, (tx) => tx.select().from(notifications).where(eq(notifications.notificationType, 'statement_ready')));
    expect(feed.some((n) => (n.payload as { rental_id?: string }).rental_id === unassignedRentalId)).toBe(true);

    const pdf = await billing.statementPdf(admin, unassignedRentalId);
    expect(Buffer.from(pdf.contentBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    await expect(billing.statementPdf(otherTenantAdmin, unassignedRentalId)).rejects.toMatchObject({
      response: { error: 'rental_not_found' },
    });
  });
});
