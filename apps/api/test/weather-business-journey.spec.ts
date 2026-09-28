import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { and, eq, sql as dsql } from 'drizzle-orm';
import {
  addresses,
  edtr as edtrTable,
  edtrLineItems,
  equipment as equipmentTable,
  equipmentAssignments,
  events as eventsTable,
  notifications,
  projectSites,
  rentals,
  weatherAlerts,
  withTenantTx,
} from '@arkilaunch/db';
import {
  FixtureWeatherAdapter,
} from '@arkilaunch/shared/testing';
import { StubPaymentsAdapter, type HourlyForecast, type HourlyForecastPort, type RequestContext } from '@arkilaunch/shared';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { SiteHubService } from '../src/sites/site-hub.service.js';
import { SitesService } from '../src/sites/sites.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { checkoutPaidWebhook } from './paymongo-webhook.js';
import { fixtureCompanyId } from './fixture-company.js';
// The weather jobs themselves, run as the ACA jobs run them (service_role).
// Loaded by path at run time, not statically imported: the jobs package
// compiles with import.meta, which the API's tsconfig does not allow.
/* eslint-disable @typescript-eslint/no-explicit-any */
const JOBS = '../../../jobs/src/';
type DeployedSite = { id: string; tenantId: string; latitude: string; longitude: string; name: string };
let briefSite: (db: any, port: HourlyForecastPort, site: DeployedSite, now: Date) => Promise<boolean>;
let hourlyWatch: (db: any, port: HourlyForecastPort, sites: DeployedSite[], now: Date) => Promise<number>;
let sitesWithDeployedEquipment: (db: any) => Promise<DeployedSite[]>;
let runWeatherPoll: (port: unknown) => Promise<void>;
let makeJobDb: () => { db: any; client: { end: () => Promise<void> } };
async function loadJobs() {
  ({ briefSite, hourlyWatch, sitesWithDeployedEquipment } = await import(/* @vite-ignore */ `${JOBS}weather-briefing.js`));
  ({ runWeatherPoll } = await import(/* @vite-ignore */ `${JOBS}weather-poll.js`));
  ({ makeJobDb } = await import(/* @vite-ignore */ `${JOBS}db-client.js`));
}
const manilaNow = () => ({ date: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) });

// docs/cr-arkilaunch-weather-monitoring.md, end to end through the
// customer's business process:
//   customer books heavy equipment -> quote -> accept -> pay (webhook) ->
//   delivered to site + timekeeper assigned -> pre-workday briefing ->
//   hourly watch -> live Stop-work warning -> timekeeper files the EDTR ->
//   checked against the recorded weather -> incident log -> office review
//   and billing -> return -> monitoring stops.
// Every weather notice must reach the timekeeper AND the customer; nothing
// the weather check finds may move money on its own (RFC-2).
describe('Weather monitoring across the heavy-equipment rental journey', () => {
  const events = new EventsService();
  const quotes = new QuotesService(new PricingEngineService(), events);
  const bookings = new BookingsService(events, quotes, new PaymentsService(new StubPaymentsAdapter(), events));
  let sessions = 0;
  const adapter = new StubPaymentsAdapter();
  adapter.createCheckoutSession = async (amountPhp: number, invoiceId: string) => ({
    id: `stub_${invoiceId}_${++sessions}`,
    checkoutUrl: `about:blank?amount=${amountPhp}`,
  });
  const payments = new PaymentsService(adapter, events);
  const edtrs = new EdtrService(events);
  const hubs = new SiteHubService(events);
  const sites = new SitesService(events);
  const feed = new NotificationsService();
  const webhookSecret = 'whsec_test_secret';

  let tenantId: string;
  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let timekeeperCtx: RequestContext;
  let customerId: string;
  let siteId: string;
  let equipmentId: string;
  let rentalId: string;
  let edtrId: string;

  const today = manilaNow().date;
  const at = (hhmm: string) => new Date(`${today}T${hhmm}:00+08:00`);
  // The hire spans today so today's EDTR and today's readings line up.
  const START = new Date(`${today}T00:00:00+08:00`);
  const END = new Date(START.getTime() + 2 * 86_400_000 + 17 * 3_600_000);

  const CALM = { tempC: 29, windKph: 8, gustKph: 12, precipMm: 0, code: 1, humidityPct: 70 };
  const STORM = { tempC: 24, windKph: 70, gustKph: 110, precipMm: 40, code: 95, humidityPct: 98 };

  function forecast(stormHours: number[]): HourlyForecastPort {
    return {
      async getHourlyForecast(): Promise<HourlyForecast[]> {
        return Array.from({ length: 11 }, (_, i) => ({
          time: `${today}T${String(7 + i).padStart(2, '0')}:00`,
          observed: stormHours.includes(7 + i) ? STORM : CALM,
        }));
      },
    };
  }

  beforeAll(async () => {
    await loadJobs();
    process.env.ENABLE_WEATHER_POLL = 'true';
    delete process.env.ENABLE_OCR_PIPELINE;
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const raw = postgres(url, { max: 1 });
    const [tenant] = await raw`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [customerUser] = await raw`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [adminUser] = await raw`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [tkUser] = await raw`select id from users where tenant_id = ${tenantId} and email = 'timekeeper@test-tenant-a.test'`;
    const [card] = await raw`select equipment_type_id from rate_cards where tenant_id = ${tenantId} and equipment_id is null and rate_type = 'hourly' and (effective_to is null or effective_to > now()) order by effective_from limit 1`;
    customerId = await fixtureCompanyId(raw, tenantId);
    await raw.end();

    customerCtx = { tenantId, userId: (customerUser as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (adminUser as { id: string }).id, role: 'admin' };
    timekeeperCtx = { tenantId, userId: (tkUser as { id: string }).id, role: 'timekeeper' };

    // A yard site and a machine of a priced type, both dedicated to this
    // spec so no other file's bookings or polls interfere.
    await withTenantTx(adminCtx, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId, line1: `Journey Wx Site ${Date.now()}`, city: 'Taguig', province: 'Metro Manila', country: 'PH' })
        .returning();
      const [site] = await tx
        .insert(projectSites)
        .values({ tenantId, addressId: address!.id, latitude: '14.520000', longitude: '121.050000' })
        .returning();
      siteId = site!.id;
      const [unit] = await tx
        .insert(equipmentTable)
        .values({
          tenantId,
          equipmentTypeId: (card as { equipment_type_id: string }).equipment_type_id,
          model: 'Journey Wx Unit',
          serialNo: `journey-wx-${Date.now()}`,
        })
        .returning();
      equipmentId = unit!.id;
    });
  });

  afterAll(async () => {
    // Never leave the unit deployed.
    await withTenantTx(adminCtx, (tx) => tx.update(equipmentTable).set({ availabilityStatus: 'available' }).where(eq(equipmentTable.id, equipmentId)));
  });

  async function feedTypes(ctx: RequestContext) {
    const page = await feed.list(ctx, { limit: 100, offset: 0 });
    return page.items
      .filter((n) => (n.payload as { project_site_id?: string } | null)?.project_site_id === siteId)
      .map((n) => n.notificationType);
  }

  it('1. the customer books, accepts the quote and pays; monitoring has not started (nothing delivered)', async () => {
    const created = await bookings.create(customerCtx, {
      customerId,
      projectSiteId: siteId,
      siteContact: 'Engr. Dela Cruz 0917 000 0000',
      items: [{ equipmentId, start: START.toISOString(), end: END.toISOString() }],
    });
    rentalId = created.id;
    await bookings.confirmCall(adminCtx, rentalId);
    const detail = await bookings.get(adminCtx, rentalId);
    expect(detail.quotation?.status).toBe('approved');
    await quotes.accept(customerCtx, detail.quotation!.id);
    const checkout = await payments.checkout(customerCtx, rentalId);
    const { rawBody, header } = await checkoutPaidWebhook(adminCtx, checkout.invoiceId, webhookSecret);
    await payments.handleWebhook(rawBody, header, webhookSecret);
    const [rental] = await withTenantTx(adminCtx, (tx) => tx.select().from(rentals).where(eq(rentals.id, rentalId)));
    expect(rental?.status).toBe('confirmed');

    const { db, client } = makeJobDb();
    try {
      expect((await sitesWithDeployedEquipment(db)).some((s) => s.id === siteId)).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('2. delivery puts the site under monitoring, and the office assigns its timekeeper', async () => {
    await bookings.deliver(adminCtx, rentalId);
    await hubs.setTimekeeper(adminCtx, siteId, timekeeperCtx.userId, true);
    const { db, client } = makeJobDb();
    try {
      expect((await sitesWithDeployedEquipment(db)).some((s) => s.id === siteId)).toBe(true);
    } finally {
      await client.end();
    }
    expect(await feedTypes(customerCtx)).toEqual([]);
  });

  it('3. the pre-workday briefing warns the timekeeper and the customer about the afternoon storm', async () => {
    const { db, client } = makeJobDb();
    try {
      const site = (await sitesWithDeployedEquipment(db)).find((s) => s.id === siteId)!;
      expect(await briefSite(db, forecast([14, 15]), site, at('05:30'))).toBe(true);
    } finally {
      await client.end();
    }
    expect(await feedTypes(timekeeperCtx)).toContain('equipment_weather_briefing');
    expect(await feedTypes(customerCtx)).toContain('equipment_weather_briefing');
    expect(await feedTypes(adminCtx)).toContain('equipment_weather_briefing');
    const [toCustomer] = (await feed.list(customerCtx, { limit: 100, offset: 0 })).items.filter(
      (n) => n.notificationType === 'equipment_weather_briefing' && (n.payload as { project_site_id?: string }).project_site_id === siteId,
    );
    const payload = toCustomer!.payload as { audience: string; rental_id: string; machines: { equipmentId: string; level: string; hours: string[] }[] };
    expect(payload.audience).toBe('customer');
    expect(payload.rental_id).toBe(rentalId);
    expect(payload.machines[0]).toMatchObject({ equipmentId, level: 'stop_work', hours: ['14:00', '15:00'] });
  });

  it('4. the hourly watch re-sends only when the outlook changes', async () => {
    const { db, client } = makeJobDb();
    try {
      const site = (await sitesWithDeployedEquipment(db)).find((s) => s.id === siteId)!;
      await hourlyWatch(db, forecast([14, 15]), [site], at('11:05'));
      expect((await feedTypes(timekeeperCtx)).filter((t) => t === 'equipment_weather_outlook')).toHaveLength(0);
      await hourlyWatch(db, forecast([12, 13, 14, 15]), [site], at('11:05'));
      expect((await feedTypes(timekeeperCtx)).filter((t) => t === 'equipment_weather_outlook')).toHaveLength(1);
      expect(await feedTypes(customerCtx)).toContain('equipment_weather_outlook');
    } finally {
      await client.end();
    }
  });

  it('5. the storm arrives: the live poll warns timekeeper and customer to stop the machine', async () => {
    await runWeatherPoll(new FixtureWeatherAdapter(STORM));
    expect(await feedTypes(timekeeperCtx)).toContain('equipment_weather_alert');
    expect(await feedTypes(customerCtx)).toContain('equipment_weather_warning');
    const [reading] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(weatherAlerts).where(eq(weatherAlerts.projectSiteId, siteId)).limit(1),
    );
    expect(reading?.severity).toBe('warning');
  });

  it('6. the timekeeper logs a full day "clear" on the machine anyway: flagged for review, logged, money untouched', async () => {
    // The day's recorded readings: the poll writes one every 30 minutes;
    // the storm ran through both halves of the shift.
    await withTenantTx(adminCtx, (tx) =>
      tx.insert(weatherAlerts).values(
        Array.from({ length: 19 }, (_, i) => ({
          tenantId,
          projectSiteId: siteId,
          severity: 'warning',
          observed: STORM,
          isStale: false,
          effectiveAt: new Date(at('07:30').getTime() + i * 30 * 60_000),
          status: 'active',
        })),
      ),
    );
    const created = await edtrs.capture(timekeeperCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: today,
      lineItems: { hoursActive: 8, hoursIdle: 0, hoursTotal: 8, weatherAm: 'C', weatherPm: 'C' } as never,
    });
    edtrId = created.id;

    const [line] = await withTenantTx(adminCtx, (tx) => tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, edtrId)));
    expect(line!.reviewFlags).toContain('weather_D2');

    const incidents = await sites.incidents(adminCtx, { limit: 50, offset: 0, projectSiteId: siteId });
    const kinds = incidents.items.map((i) => i.kind);
    expect(kinds).toContain('used_despite_warning');
    expect(kinds).toContain('discrepancy');
    const d2 = incidents.items.find((i) => i.kind === 'discrepancy')!;
    expect(d2.detail).toContain('mm rain recorded');
    expect(d2.detail).toContain('For review, not a finding');

    // Evidence only: no weather hold reason on the EDTR, no deduction.
    const [row] = await withTenantTx(adminCtx, (tx) => tx.select().from(edtrTable).where(eq(edtrTable.id, edtrId)));
    expect(row!.lastError ?? '').not.toContain('weather_');
  });

  it('7. the office reviews and approves the day by hand; billing follows the human decision', async () => {
    const result = await edtrs.review(adminCtx, edtrId, {
      decision: 'approve',
      hours: { hoursActive: 8, hoursIdle: 0, hoursBreakdown: 0, hoursWeather: 0, hoursOtherDowntime: 0, hoursTotal: 8 },
    } as never);
    expect('invoiceLine' in result).toBe(true);
    const [row] = await withTenantTx(adminCtx, (tx) => tx.select().from(edtrTable).where(eq(edtrTable.id, edtrId)));
    expect(['approved', 'reconciled']).toContain(row!.status);
  });

  it('8. on return the site leaves monitoring: no more briefings or warnings', async () => {
    await bookings.markReturned(adminCtx, rentalId);
    const { db, client } = makeJobDb();
    try {
      expect((await sitesWithDeployedEquipment(db)).some((s) => s.id === siteId)).toBe(false);
    } finally {
      await client.end();
    }
    const before = (await feedTypes(timekeeperCtx)).length;
    await runWeatherPoll(new FixtureWeatherAdapter({ ...STORM, gustKph: 130 }));
    expect((await feedTypes(timekeeperCtx)).length).toBe(before);

    // The customer's feed tells the whole story, in order of the journey.
    const types = await feedTypes(customerCtx);
    expect(types).toEqual(expect.arrayContaining(['equipment_weather_briefing', 'equipment_weather_outlook', 'equipment_weather_warning']));
    const warned = await withTenantTx(adminCtx, (tx) =>
      tx
        .select()
        .from(eventsTable)
        .where(and(eq(eventsTable.name, 'equipment_weather_warning'), dsql`${eventsTable.properties} ->> 'project_site_id' = ${siteId}`)),
    );
    expect(warned.length).toBeGreaterThan(0);
    void notifications;
    void equipmentAssignments;
  });
});
