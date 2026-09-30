import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

// A fresh TIN per company: one login cannot apply for the same TIN twice.
const randomTin = () => String(Math.floor(Math.random() * 1e9)).padStart(9, '1');
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import {
  StubPaymentsAdapter,
  UnavailableDocumentIntelligenceAdapter,
  WeatherUnavailableError,
  type RequestContext,
} from '@arkilaunch/shared';
import { FixtureDocumentIntelligenceAdapter } from '@arkilaunch/shared/testing';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { CustomersService, __clearForecastCache } from '../src/customers/customers.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// What a reviewer ticks before approving: the PhilSys QR verified on
// PhilSys Check, the selfie matches the ID, the holder may act for the company.
const IDENTITY = { philsysVerified: true, selfieMatches: true, holderAuthorized: true } as const;
import { JwtService } from '@nestjs/jwt';

// Sign up, add a company and site, book, and cannot pay until staff verify; nobody else can use the company.
function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

describe('Customer onboarding', () => {
  const events = new EventsService();
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
  const companies = new CustomersService(
    events,
    new UnavailableDocumentIntelligenceAdapter('flag_disabled'),
  );
  const quotes = new QuotesService(new PricingEngineService(), events);
  // Auto-quoting off: this suite covers bookings/payments, not pricing
  // (customer-journey.spec.ts covers the automatic quote).
  const bookings = new BookingsService(events, { autoQuoteBooking: async () => null } as unknown as QuotesService, new PaymentsService(new StubPaymentsAdapter(), new EventsService()));
  let sessions = 0;
  const adapter = new StubPaymentsAdapter();
  adapter.createCheckoutSession = async (amountPhp: number, invoiceId: string) => ({
    id: `stub_${invoiceId}_${++sessions}_${randomUUID()}`,
    checkoutUrl: `about:blank?amount=${amountPhp}`,
  });
  const payments = new PaymentsService(adapter, events);

  let tenantId: string;
  let adminCtx: RequestContext;
  let seededCustomerCtx: RequestContext;
  let otherTenantCtx: RequestContext;
  let equipmentId: string;
  const email = `signup-${randomUUID().slice(0, 8)}@onboarding.test`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    tenantId = (tenantA as { id: string }).id;
    const [customerUser] =
      await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [adminUser] =
      await sql`select id from users where tenant_id = ${tenantId} and id <> ${(customerUser as { id: string }).id} limit 1`;
    const [userB] =
      await sql`select id from users where tenant_id = ${(tenantB as { id: string }).id} limit 1`;
    const [unit] =
      await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    seededCustomerCtx = { tenantId, userId: (customerUser as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (adminUser as { id: string }).id, role: 'admin' };
    otherTenantCtx = {
      tenantId: (tenantB as { id: string }).id,
      userId: (userB as { id: string }).id,
      role: 'admin',
    };
    equipmentId = (unit as { id: string }).id;
    // This spec's own 2032-05 bookings from a prior run.
    const stale =
      await sql`select distinct rental_id from equipment_assignments where equipment_id = ${equipmentId} and start >= '2032-05-01' and start < '2032-06-01'`;
    const ids = stale.map((row) => (row as { rental_id: string }).rental_id);
    if (ids.length > 0) {
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoices where rental_id = any(${ids})`;
      await sql`delete from equipment_assignments where rental_id = any(${ids})`;
      await sql`delete from rentals where id = any(${ids})`;
    }
    await sql.end();
  });

  function decodeCtx(accessToken: string): RequestContext {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString()) as {
      tenantId: string;
      sub: string;
      role: string;
    };
    return {
      tenantId: claims.tenantId,
      userId: claims.sub,
      role: claims.role as RequestContext['role'],
    };
  }

  const window = (d: number) => ({
    start: new Date(Date.UTC(2032, 4, 1 + d, 8)).toISOString(),
    end: new Date(Date.UTC(2032, 4, 1 + d, 17)).toISOString(),
  });

  it('signs up, adds two companies and a site, books, and pays only once verified', async () => {
    const tokens = await auth.registerCustomer({
      email,
      password: 'correct horse battery',
      acceptedTerms: true,
    }, 'test-tenant-a');
    const ctx = decodeCtx(tokens.accessToken);
    expect(ctx).toMatchObject({ tenantId, role: 'customer' });

    // The same email cannot sign up twice, in any tenant.
    await expect(
      auth.registerCustomer({ email, password: 'another long password', acceptedTerms: true }, 'test-tenant-a'),
    ).rejects.toBeInstanceOf(ConflictException);

    const details = {
      billingAddress: '1248 North Quarry Way, Pasig',
      contactMobile: '09170000000',
    };
    const acme = await companies.createCompany(ctx, {
      companyName: 'Acme Builders',
      tin: '123-456-789',
      secNumber: 'PH62780901',
      ...details,
    });
    // The card shows this as "Registration Number" (Figma 251:1945).
    expect(acme.secNumber).toBe('PH62780901');
    expect((await companies.listCompanies(ctx)).find((c) => c.id === acme.id)?.secNumber).toBe(
      'PH62780901',
    );
    // One application per company: the same TIN (head office written
    // either way), SEC number or name again is refused, not a second row.
    for (const again of [
      { companyName: 'Acme Builders Two', tin: '123-456-789-000' },
      { companyName: 'Another Name', secNumber: 'ph 62780901' },
      { companyName: 'ACME builders' },
    ]) {
      await expect(companies.createCompany(ctx, { ...details, ...again })).rejects.toMatchObject({
        response: { error: 'company_already_applied', companyId: acme.id },
      });
    }
    const beta = await companies.createCompany(ctx, { companyName: 'Beta Works', tin: '987-654-321', ...details });
    expect((await companies.listCompanies(ctx)).map((c) => c.companyName).sort()).toEqual([
      'Acme Builders',
      'Beta Works',
    ]);

    await companies.addDocument(
      ctx,
      acme.id,
      'government_id',
      `${tenantId}/test/id.jpg`,
      Buffer.from('not-really-an-image'),
    );
    await companies.addDocument(ctx, acme.id, 'selfie_with_id', `${tenantId}/test/selfie.jpg`, Buffer.from('not-really-an-image'));
    const acmeSec = await companies.addDocument(ctx, acme.id, 'sec_certificate', `${tenantId}/test/sec.jpg`, Buffer.from('not-really-an-image'));
    const site = await companies.createSite(ctx, {
      customerId: acme.id,
      line1: 'Lot 4 Ortigas Ave',
      city: 'Pasig',
      province: 'Metro Manila',
      latitude: 14.58,
      longitude: 121.06,
    });
    expect(await companies.listSites(ctx)).toHaveLength(1);

    // With two companies the customer must say which one books.
    await expect(
      bookings.create(ctx, {
        projectSiteId: site.id,
        items: [window(0)].map((w) => ({ equipmentId, ...w })),
      }),
    ).rejects.toMatchObject({
      response: { error: 'company_required' },
    });
    // Acme's site cannot carry a Beta booking.
    await expect(
      bookings.create(ctx, {
        customerId: beta.id,
        projectSiteId: site.id,
        items: [{ equipmentId, ...window(0) }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Unverified: no booking at all. Verified by staff: booking opens.
    await expect(
      bookings.create(ctx, { customerId: acme.id, projectSiteId: site.id, items: [{ equipmentId, ...window(0) }] }),
    ).rejects.toMatchObject({ response: { error: 'company_not_verified' } });
    // Nor can staff quote it.
    await expect(
      quotes.create(adminCtx, {
        customerId: acme.id,
        projectSiteId: site.id,
        rentalId: randomUUID(),
        discount: { type: 'none', value: 0 },
        items: [{ equipmentTypeId: randomUUID(), rateCardId: randomUUID(), quantity: 1, estimatedHours: 1, mobilizationKm: 0, demobilizationKm: 0 }],
      }),
    ).rejects.toMatchObject({ response: { error: 'company_not_verified' } });
    const queue = (await companies.listForReview(adminCtx, 'pending')).items;
    expect(queue.find((c) => c.id === acme.id)?.documents).toHaveLength(3);
    await companies.decide(adminCtx, acme.id, { decision: 'approved', identity: IDENTITY, registryChecked: [acmeSec.id], cureDocuments: [] });

    // Verified, but the site has not shown it is real: no job on it yet.
    await expect(
      bookings.create(ctx, { customerId: acme.id, projectSiteId: site.id, items: [{ equipmentId, ...window(0) }] }),
    ).rejects.toMatchObject({ response: { error: 'site_proof_required' } });
    expect((await companies.listSites(ctx))[0]?.proofComplete).toBe(false);
    await companies.addSiteDocument(ctx, site.id, 'site_photo', `${tenantId}/test/site.jpg`);
    // A photo alone is not proof; it needs a permit, NTP, title/lease or clearance.
    expect((await companies.listSites(ctx))[0]?.proofComplete).toBe(false);
    await companies.addSiteDocument(ctx, site.id, 'building_permit', `${tenantId}/test/permit.jpg`);
    expect((await companies.listSites(ctx))[0]?.proofComplete).toBe(true);
    // Staff see the same proof from the booking.
    expect((await companies.listSiteDocuments(adminCtx, site.id)).documents.map((d) => d.documentType).sort()).toEqual([
      'building_permit',
      'site_photo',
    ]);

    const booking = await bookings.create(ctx, {
      customerId: acme.id,
      projectSiteId: site.id,
      items: [{ equipmentId, ...window(0) }],
    });
    expect((await bookings.list(ctx, { limit: 10, offset: 0 })).items.map((b) => b.id)).toContain(
      booking.id,
    );

    // Verified but not yet called back: still no payment.
    await expect(payments.checkout(ctx, booking.id)).rejects.toMatchObject({
      response: { error: 'call_not_confirmed' },
    });
    await bookings.requestCall(ctx, booking.id);
    await bookings.confirmCall(adminCtx, booking.id);
    const checkout = await payments.checkout(ctx, booking.id);
    expect(checkout.checkoutUrl).toContain('about:blank');

    await bookings.cancel(ctx, booking.id);
  });

  it('keeps one customer out of another’s companies and sites, and other tenants out entirely', async () => {
    const tokens = await auth.registerCustomer({
      email: `signup-${randomUUID().slice(0, 8)}@onboarding.test`,
      password: 'correct horse battery',
      acceptedTerms: true,
    }, 'test-tenant-a');
    const ctx = decodeCtx(tokens.accessToken);
    const mine = await companies.createCompany(ctx, {
      companyName: 'Gamma Corp',
      tin: randomTin(),
      billingAddress: 'Somewhere, Cebu',
      contactMobile: '09180000000',
    });

    // Another customer in the same tenant cannot attach a document or site.
    await expect(
      companies.addDocument(
        seededCustomerCtx,
        mine.id,
        'government_id',
        'x',
        Buffer.from('not-really-an-image'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      companies.createSite(seededCustomerCtx, {
        customerId: mine.id,
        line1: 'x st',
        city: 'Cebu',
        province: 'Cebu',
        latitude: 10.3,
        longitude: 123.9,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await companies.listCompanies(seededCustomerCtx)).map((c) => c.id)).not.toContain(
      mine.id,
    );

    // Without the ownership predicate on top of RLS, one customer could pull another's KYC evidence.
    const myDoc = await companies.addDocument(
      ctx,
      mine.id,
      'sec_certificate',
      `${tenantId}/test/gamma-registration.jpg`,
      Buffer.from('not-really-an-image'),
    );
    await expect(companies.ownDocumentKey(ctx, mine.id, myDoc.id)).resolves.toContain(
      'gamma-registration.jpg',
    );
    await expect(
      companies.ownDocumentKey(seededCustomerCtx, mine.id, myDoc.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Staff never reach the ownership check: assertCustomer refuses the role first.
    await expect(
      companies.ownDocumentKey(adminCtx, mine.id, myDoc.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      companies.ownDocumentKey(otherTenantCtx, mine.id, myDoc.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Staff cannot create companies under their own login.
    await expect(companies.listCompanies(adminCtx)).rejects.toBeInstanceOf(ForbiddenException);

    // Tenant B's staff see nothing of tenant A's queue.
    expect(
      (await companies.listForReview(otherTenantCtx, 'pending')).items.map((c) => c.id),
    ).not.toContain(mine.id);
    await expect(
      companies.decide(otherTenantCtx, mine.id, { decision: 'approved', identity: IDENTITY, registryChecked: [], cureDocuments: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });


  describe('site forecast', () => {
    const DAYS = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-09-2${i}`,
      tempMaxC: 32,
      tempMinC: 25,
      windMaxKph: 18,
      precipMm: 1.5,
      code: 3,
    }));

    function counting(days = DAYS) {
      let calls = 0;
      const port = {
        async getForecast() {
          calls += 1;
          return days;
        },
      };
      return { port, calls: () => calls };
    }

    function serviceWith(port: { getForecast: () => Promise<typeof DAYS> }) {
      return new CustomersService(
        events,
        new UnavailableDocumentIntelligenceAdapter('flag_disabled'),
        port,
      );
    }

    async function siteFor(ctx: RequestContext, service: CustomersService, city: string) {
      const company = await service.createCompany(ctx, {
        companyName: `Forecast ${city} ${randomUUID().slice(0, 6)}`,
        tin: randomTin(),
        billingAddress: `1 ${city} Road`,
        contactMobile: '09170000000',
      });
      return service.createSite(ctx, {
        customerId: company.id,
        line1: `1 ${city} Road`,
        city,
        province: 'Metro Manila',
        latitude: 14.58,
        longitude: 121.06,
      });
    }

    let ownerCtx: RequestContext;

    beforeAll(async () => {
      const tokens = await auth.registerCustomer({
        email: `forecast-${randomUUID().slice(0, 8)}@onboarding.test`,
        password: 'correct horse battery',
        acceptedTerms: true,
      }, 'test-tenant-a');
      ownerCtx = decodeCtx(tokens.accessToken);
    });

    beforeEach(() => {
      __clearForecastCache();
    });

    it('returns five days for the caller own site, unmodified', async () => {
      const { port } = counting();
      const service = serviceWith(port);
      const site = await siteFor(ownerCtx, service, 'Pasig');

      const forecast = await service.siteForecast(ownerCtx, site.id);
      expect(forecast.siteId).toBe(site.id);
      expect(forecast.days).toEqual(DAYS);
      expect(forecast.fetchedAt).toMatch(/^\d{4}-/);
    });

    // Without ownCustomers() on top of RLS, this would tell one customer where another is working.
    it('refuses another customer site in the same tenant', async () => {
      const { port } = counting();
      const service = serviceWith(port);
      const site = await siteFor(ownerCtx, service, 'Makati');

      await expect(service.siteForecast(seededCustomerCtx, site.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses a staff login: this is the customer own surface', async () => {
      const { port } = counting();
      const service = serviceWith(port);
      const site = await siteFor(ownerCtx, service, 'Taguig');

      await expect(service.siteForecast(adminCtx, site.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.siteForecast(otherTenantCtx, site.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    // The one failure mode that can hurt someone: an empty week or a row of
    // zeros reads as a calm five days rather than as missing data.
    it('reports an unavailable forecast as unavailable, never as an empty week', async () => {
      const service = serviceWith({
        async getForecast() {
          throw new WeatherUnavailableError('flag_disabled');
        },
      });
      const site = await siteFor(ownerCtx, service, 'Mandaluyong');

      await expect(service.siteForecast(ownerCtx, site.id)).rejects.toMatchObject({
        response: { error: 'weather_unavailable', reason: 'flag_disabled' },
      });
    });

    it('serves a second read from cache rather than paying the free tier twice', async () => {
      const { port, calls } = counting();
      const service = serviceWith(port);
      const site = await siteFor(ownerCtx, service, 'Ortigas');

      await service.siteForecast(ownerCtx, site.id);
      await service.siteForecast(ownerCtx, site.id);
      expect(calls()).toBe(1);
    });

    it('does not cache a failure into the next half hour', async () => {
      let attempts = 0;
      const service = serviceWith({
        async getForecast() {
          attempts += 1;
          throw new WeatherUnavailableError('no_adapter');
        },
      });
      const site = await siteFor(ownerCtx, service, 'Cubao');

      await expect(service.siteForecast(ownerCtx, site.id)).rejects.toBeTruthy();
      await expect(service.siteForecast(ownerCtx, site.id)).rejects.toBeTruthy();
      expect(attempts).toBe(2);
    });
  });

  // Scan-first onboarding: the scan only fills the form in. It must not
  // write a document row or decide anything -- staff still review.
  describe('company document scan', () => {
    const scanner = (fields: Record<string, { value: string; confidence: number }>) =>
      new CustomersService(events, new FixtureDocumentIntelligenceAdapter({ fields }));
    const bytes = Buffer.from('not-really-an-image');

    const companyFields = {
      company_name: { value: 'Almara Construction Corporation', confidence: 0.9 },
      tin: { value: '123 456 789', confidence: 0.93 },
      sec_number: { value: 'CS202312345', confidence: 0.95 },
      dti_number: { value: '1234567', confidence: 0.94 },
      registered_address: { value: '12 Yard Road, Cebu City', confidence: 0.6 },
    };

    it('suggests only what the scanned paper carries, for the customer to correct', async () => {
      const service = scanner(companyFields);
      const sec = await service.scanDocument(seededCustomerCtx, 'sec_certificate', bytes);
      expect(sec.suggestions).toMatchObject({
        companyName: 'Almara Construction Corporation',
        secNumber: 'CS202312345',
        // An SEC certificate prints only the SEC's own address.
        address: null,
        tin: null,
        dtiNumber: null,
      });
      // The address is free text and does not drag legibility down.
      expect(sec.confidence).toBeCloseTo(0.9);
      expect(sec.extractionAvailable).toBe(true);
      // No page text came back to judge the paper by.
      expect(sec.layoutRecognized).toBeNull();

      const bir = await service.scanDocument(seededCustomerCtx, 'bir_cor', bytes);
      // Normalised into the canonical dashed TIN.
      expect(bir.suggestions).toMatchObject({ tin: '123-456-789', secNumber: null, dtiNumber: null });

      const dti = await service.scanDocument(seededCustomerCtx, 'dti_certificate', bytes);
      expect(dti.suggestions).toMatchObject({ dtiNumber: '1234567', tin: null, secNumber: null });
    });

    it('reads every National ID detail, normalised for the form', async () => {
      const service = scanner({
        first_name: { value: 'JUAN', confidence: 0.95 },
        middle_name: { value: 'MERCADO', confidence: 0.93 },
        last_name: { value: 'DELA CRUZ', confidence: 0.96 },
        id_number: { value: '1234 5678 9012 3456', confidence: 0.97 },
        birth_date: { value: 'JANUARY 02, 1990', confidence: 0.92 },
        sex: { value: 'MALE', confidence: 0.99 },
        address: { value: '1 Rizal St, Quezon City', confidence: 0.7 },
        tin: { value: '123-456-789', confidence: 0.99 },
      });
      const scan = await service.scanDocument(seededCustomerCtx, 'government_id', bytes);
      expect(scan.suggestions).toMatchObject({
        firstName: 'JUAN',
        middleName: 'MERCADO',
        lastName: 'DELA CRUZ',
        idNumber: '1234-5678-9012-3456',
        birthDate: '1990-01-02',
        sex: 'M',
        address: '1 Rizal St, Quezon City',
        // An ID never suggests a company number, whatever the model said.
        tin: null,
      });
      expect(scan.confidence).toBeCloseTo(0.92);
    });

    it('does not call a sharp ID unclear over fields the card front does not print', async () => {
      const service = scanner({
        first_name: { value: 'KIMBERLY', confidence: 0.95 },
        middle_name: { value: '', confidence: 0.4 },
        last_name: { value: 'CORREA', confidence: 0.96 },
        id_number: { value: '5467-9368-4538-7147', confidence: 0.97 },
        birth_date: { value: 'DECEMBER 28, 2007', confidence: 0.94 },
        // Guessed: sex is on the back of a PhilSys card.
        sex: { value: 'F', confidence: 0.3 },
      });
      const scan = await service.scanDocument(seededCustomerCtx, 'government_id', bytes);
      expect(scan.confidence).toBeCloseTo(0.94);

      // A PCN that fails its format is dropped, and does not score either.
      const bad = await scanner({
        first_name: { value: 'KIMBERLY', confidence: 0.95 },
        id_number: { value: '54679', confidence: 0.2 },
      }).scanDocument(seededCustomerCtx, 'government_id', bytes);
      expect(bad.suggestions.idNumber).toBeNull();
      expect(bad.confidence).toBeCloseTo(0.95);
    });

    it('drops a value that fails its format check rather than suggesting it', async () => {
      const service = scanner({
        tin: { value: 'not-a-tin', confidence: 0.99 },
        sec_number: { value: '??', confidence: 0.99 },
      });
      expect((await service.scanDocument(seededCustomerCtx, 'bir_cor', bytes)).suggestions.tin).toBeNull();
      expect(
        (await service.scanDocument(seededCustomerCtx, 'sec_certificate', bytes)).suggestions.secNumber,
      ).toBeNull();
    });

    it('says so instead of inventing values when no extractor is available', async () => {
      const scan = await companies.scanDocument(seededCustomerCtx, 'bir_cor', bytes);
      expect(scan).toEqual({
        suggestions: {
      companyName: null,
      tin: null,
      secNumber: null,
      dtiNumber: null,
      address: null,
      firstName: null,
      middleName: null,
      lastName: null,
      idNumber: null,
      birthDate: null,
      sex: null,
    },
        confidence: null,
        extractionAvailable: false,
        layoutRecognized: null,
      });
    });

    // Shaped like a real eSPARC read (identifiers synthetic): the label parser beats the query.
    const secText = [
      'REPUBLIC OF THE PHILIPPINES SECURITIES AND EXCHANGE COMMISSION 3/F Newtown Square, Navy Base Road, Baguio City',
      'COMPANY REG. NO .: 2022090000001-02',
      'CERTIFICATE OF INCORPORATION',
      'This is to certify that the Articles of Incorporation and By Laws of:',
      'BENGUET HIGHLANDS FARMERS ASSOCIATION INC.',
      'were duly approved by the Commission on this date, which took effect on February 23, 2019.',
      'IN WITNESS WHEREOF, I have hereunto set my hand at Baguio City, Philippines, this day of 16 September Two Thousand Twenty Two.',
    ].join('\n');
    const withText = (content: string) => {
      const words = [...content.matchAll(/\S+/g)].map((m) => ({ offset: m.index, length: m[0].length, confidence: 0.98 }));
      return new CustomersService(
        events,
        new FixtureDocumentIntelligenceAdapter({
          fields: {
            company_name: { value: 'BENGUET HIGHLANDS FARMERS ASSOCIATION INC.', confidence: 0.6 },
            registered_address: { value: '3/F Newtown Square, Navy Base Road, Baguio City', confidence: 0.97 },
            registration_date: { value: 'February 23, 2019', confidence: 0.65 },
          },
          text: { content, words, lines: [] },
        }),
      );
    };

    it('reads an SEC certificate by its labels: the reg no. the query missed, no letterhead address', async () => {
      const scan = await withText(secText).scanDocument(seededCustomerCtx, 'sec_certificate', bytes);
      expect(scan.layoutRecognized).toBe(true);
      expect(scan.suggestions).toMatchObject({
        companyName: 'BENGUET HIGHLANDS FARMERS ASSOCIATION INC.',
        secNumber: '2022090000001-02',
        address: null,
      });
      expect(scan.confidence).toBeCloseTo(0.98);
    });

    it('warns when the paper is not the one it was scanned as', async () => {
      const scan = await withText(secText).scanDocument(seededCustomerCtx, 'bir_cor', bytes);
      expect(scan.layoutRecognized).toBe(false);
    });

    it('writes nothing: no document row, no verification decision', async () => {
      const service = scanner({ tin: { value: '123-456-789', confidence: 0.93 } });
      const url = process.env.DATABASE_URL_DIRECT!;
      const sql = postgres(url, { max: 1 });
      const before = await sql`select count(*)::int as n from kyc_documents`;
      await service.scanDocument(seededCustomerCtx, 'bir_cor', bytes);
      const after = await sql`select count(*)::int as n from kyc_documents`;
      await sql.end();
      expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n);
    });

    it("refuses a staff role: this is the customer's own typing aid", async () => {
      const service = scanner({ tin: { value: '123-456-789', confidence: 0.93 } });
      await expect(service.scanDocument(adminCtx, 'bir_cor', bytes)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // Nothing here decides anything on the extraction's own.
  describe('staff document review', () => {
    const reviewer = (fields: Record<string, { value: string; confidence: number }>) =>
      new CustomersService(events, new FixtureDocumentIntelligenceAdapter({ fields }));
    const bytes = Buffer.from('not-really-an-image');
    // Its own customer: bookings.create()'s implicit-company selection breaks once the seeded one owns several.
    let reviewCtx: RequestContext;

    beforeAll(async () => {
      const tokens = await auth.registerCustomer({
        email: `staff-review-${randomUUID().slice(0, 8)}@onboarding.test`,
        password: 'correct horse battery',
        acceptedTerms: true,
      }, 'test-tenant-a');
      reviewCtx = decodeCtx(tokens.accessToken);
    });

    async function companyWithRegistration(name: string, documentType = 'sec_certificate') {
      const company = await companies.createCompany(reviewCtx, {
        companyName: name,
        tin: randomTin(),
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const doc = await companies.addDocument(
        reviewCtx,
        company.id,
        documentType,
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      return { companyId: company.id, documentId: doc.id };
    }

    // A submitted company: National ID (with the name the customer
    // confirmed), a selfie holding it, and an SEC certificate.
    async function completeCompany(name: string) {
      const { companyId, documentId } = await companyWithRegistration(name);
      await companies.addDocument(reviewCtx, companyId, 'government_id', `storage://fixtures/${randomUUID()}.jpg`, bytes, {
        firstName: 'Maria',
        middleName: 'Reyes',
        lastName: 'Santos',
        idNumber: '1234-5678-9012-3456',
      });
      await companies.addDocument(reviewCtx, companyId, 'selfie_with_id', `storage://fixtures/${randomUUID()}.jpg`, bytes);
      return { companyId, secId: documentId };
    }

    it('reads the document onto the row without deciding anything', async () => {
      const { companyId, documentId } = await companyWithRegistration('Reviewme Corp', 'company_registration');
      const service = reviewer({
        company_name: { value: 'REVIEWME CORPORATION', confidence: 0.88 },
        tin: { value: '123-456-789', confidence: 0.93 },
        sec_number: { value: 'CS202312345', confidence: 0.95 },
      });

      const read = await service.readDocument(adminCtx, companyId, documentId, bytes);
      expect(read.suggestions.companyName).toBe('REVIEWME CORPORATION');
      expect(read.formatValid).toEqual({ tin: true, secNumber: true, dtiNumber: false, idNumber: false });
      // The weakest field, not the strongest.
      expect(read.confidence).toBeCloseTo(0.88);

      const [company] = await companies
        .listForReview(adminCtx, 'pending')
        .then((all) => all.items.filter((c) => c.id === companyId));
      expect(company?.kycStatus).toBe('pending'); // unchanged by reading
      expect(company?.companyName).toBe('Reviewme Corp'); // not overwritten by OCR
    });

    it('reports a malformed value as invalid instead of hiding it', async () => {
      const { companyId, documentId } = await companyWithRegistration('Badformat Corp', 'bir_cor');
      const service = reviewer({ tin: { value: '12-34', confidence: 0.91 } });
      const read = await service.readDocument(adminCtx, companyId, documentId, bytes);
      expect(read.suggestions.tin).toBe('12-34');
      expect(read.formatValid.tin).toBe(false);
    });

    it('records the format check for the DTI number and the PCN as well', async () => {
      const dti = await companyWithRegistration('Dti Format Corp', 'dti_certificate');
      const dtiRead = await reviewer({ dti_number: { value: '3456789', confidence: 0.95 } }).readDocument(
        adminCtx,
        dti.companyId,
        dti.documentId,
        bytes,
      );
      expect(dtiRead.formatValid.dtiNumber).toBe(true);
      const id = await companyWithRegistration('Pcn Format Corp', 'government_id');
      await reviewer({ id_number: { value: '1234', confidence: 0.95 } }).readDocument(
        adminCtx,
        id.companyId,
        id.documentId,
        bytes,
      );
      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        const rows = await sql<{ id: string; format_valid: Record<string, boolean> }[]>`
          select id, format_valid from kyc_documents where id in (${dti.documentId}, ${id.documentId})
        `;
        const stored = Object.fromEntries(rows.map((r) => [r.id, r.format_valid]));
        expect(stored[dti.documentId]).toMatchObject({ dti_number: true });
        expect(stored[id.documentId]).toMatchObject({ id_number: false });
      } finally {
        await sql.end();
      }
    });

    it('approves exactly what the customer submitted, after the identity checks', async () => {
      const { companyId, secId } = await completeCompany('As Sent Corp');
      // No identity checks, no approval.
      await expect(
        companies.decide(adminCtx, companyId, { decision: 'approved', registryChecked: [secId], cureDocuments: [] }),
      ).rejects.toMatchObject({ response: { error: 'identity_checks_required' } });
      await companies.decide(adminCtx, companyId, { decision: 'approved', identity: IDENTITY, registryChecked: [secId], cureDocuments: [] });
      const approved = (await companies.listForReview(adminCtx, 'approved')).items.find((c) => c.id === companyId);
      expect(approved?.companyName).toBe('As Sent Corp');
      expect(approved?.tin).toMatch(/^\d{9}$/);
      expect(approved?.rejection).toBeNull();
      expect(approved?.documents.find((d) => d.id === secId)?.registryChecked).toBe(true);
    });

    it('refuses approval without the ID, the selfie and a registration', async () => {
      const { companyId, documentId } = await companyWithRegistration('Half Done Corp');
      await expect(
        companies.decide(adminCtx, companyId, { decision: 'approved', identity: IDENTITY, registryChecked: [documentId], cureDocuments: [] }),
      ).rejects.toMatchObject({ response: { error: 'documents_incomplete' } });
    });

    it('refuses approval until every SEC/BIR/DTI paper is ticked as checked on its registry', async () => {
      const { companyId, secId: documentId } = await completeCompany('Unchecked Corp');
      const dti = await companies.addDocument(
        reviewCtx,
        companyId,
        'dti_certificate',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      await expect(
        companies.decide(adminCtx, companyId, { decision: 'approved', identity: IDENTITY, registryChecked: [documentId], cureDocuments: [] }),
      ).rejects.toMatchObject({
        response: { error: 'registry_check_required', documentTypes: ['dti_certificate'] },
      });
      // Rejecting needs no registry check, only a reason.
      await expect(companies.decide(adminCtx, companyId, { decision: 'rejected', registryChecked: [], cureDocuments: [] })).rejects.toMatchObject({
        response: { error: 'rejection_reason_required' },
      });
      await companies.decide(adminCtx, companyId, { decision: 'rejected', reason: 'dti_expired', registryChecked: [], cureDocuments: [] });
      const rejected = (await companies.listForReview(adminCtx, 'rejected')).items.find((c) => c.id === companyId);
      expect(rejected?.documents.find((d) => d.id === dti.id)?.registryChecked).toBe(false);
    });

    it('keeps what the customer confirmed beside the OCR, through a staff re-read', async () => {
      const service = reviewer({
        first_name: { value: 'JUAN', confidence: 0.95 },
        last_name: { value: 'DELA CRUZ', confidence: 0.96 },
        id_number: { value: '1234567890123456', confidence: 0.95 },
      });
      const company = await service.createCompany(reviewCtx, {
        companyName: 'Confirmed Corp',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const doc = await service.addDocument(
        reviewCtx,
        company.id,
        'government_id',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
        { firstName: 'Juan', lastName: 'Dela Cruz', idNumber: '1234-5678-9012-3457', sex: 'M' },
      );
      const read = async () =>
        (await companies.listForReview(adminCtx, 'pending')).items
          .find((c) => c.id === company.id)!
          .documents.find((d) => d.id === doc.id)!;

      const before = await read();
      expect(before.ocr).toMatchObject({ first_name: 'JUAN', id_number: '1234-5678-9012-3456' });
      expect(before.customer).toEqual({
        first_name: 'Juan',
        last_name: 'Dela Cruz',
        id_number: '1234-5678-9012-3457',
        sex: 'M',
      });
      expect(before.confidence).toBeCloseTo(0.95);

      await service.readDocument(adminCtx, company.id, doc.id, bytes);
      expect((await read()).customer.id_number).toBe('1234-5678-9012-3457');
    });

    it('records the reason and the papers that cure it when the reviewer rejects', async () => {
      const { companyId } = await completeCompany('Reject Corp');
      await companies.decide(adminCtx, companyId, {
        decision: 'rejected',
        reason: 'sec_not_in_good_standing',
        note: 'Check with SEC shows it suspended since 2024.',
        registryChecked: [],
        cureDocuments: [],
      });
      const rejected = (await companies.listForReview(adminCtx, 'rejected')).items.find((c) => c.id === companyId);
      expect(rejected?.companyName).toBe('Reject Corp');
      expect(rejected?.rejection).toMatchObject({
        reason: 'sec_not_in_good_standing',
        note: 'Check with SEC shows it suspended since 2024.',
        cureDocuments: ['sec_good_standing', 'sec_gis'],
        final: false,
      });
    });

    it('keeps a fraudulent rejection final: no uploads, no reapplying', async () => {
      const { companyId } = await completeCompany('Forged Corp');
      await companies.decide(adminCtx, companyId, { decision: 'rejected', reason: 'fraudulent', registryChecked: [], cureDocuments: [] });
      await expect(
        companies.addDocument(reviewCtx, companyId, 'sec_certificate', `storage://fixtures/${randomUUID()}.jpg`, bytes),
      ).rejects.toMatchObject({ response: { error: 'rejection_final' } });
      await expect(companies.reapply(reviewCtx, companyId)).rejects.toMatchObject({ response: { error: 'rejection_final' } });
    });

    it('refuses a document that belongs to another company', async () => {
      const mine = await companyWithRegistration('Mine Corp');
      const other = await companyWithRegistration('Other Corp');
      const service = reviewer({ tin: { value: '123-456-789', confidence: 0.9 } });
      await expect(
        service.readDocument(adminCtx, mine.companyId, other.documentId, bytes),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('queues every upload for review, however well it read: nothing is bounced back', async () => {
      const illegible = reviewer({ first_name: { value: 'J', confidence: 0.4 } });
      const company = await illegible.createCompany(reviewCtx, {
        companyName: 'Blurry Scan Corp',
        tin: randomTin(),
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const doc = await illegible.addDocument(
        reviewCtx,
        company.id,
        'government_id',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      expect(doc.status).toBe('needs_review');
    });

    it('takes the SEC number off the scanned certificate and refuses a typed change after', async () => {
      const service = reviewer({ sec_number: { value: 'CS202312345', confidence: 0.95 } });
      const company = await service.createCompany(reviewCtx, {
        companyName: `Secnum Corp ${randomUUID().slice(0, 6)}`,
        secNumber: 'CS201900001',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      await service.addDocument(reviewCtx, company.id, 'sec_certificate', `storage://fixtures/${randomUUID()}.jpg`, bytes);
      const [after] = (await service.listCompanies(reviewCtx)).filter((c) => c.id === company.id);
      expect(after?.secNumber).toBe('CS202312345');
      await expect(service.updateCompany(reviewCtx, company.id, { secNumber: 'CS201900001' })).rejects.toMatchObject({
        response: { error: 'sec_number_from_document' },
      });
    });

    it('locks a submitted company; a rejection opens the cure, and reapplying sends it back', async () => {
      const service = reviewer({ tin: { value: '111-222-333', confidence: 0.95 } });
      const company = await service.createCompany(reviewCtx, {
        companyName: 'Locked Corp',
        tin: randomTin(),
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const upload = (type: string) =>
        service.addDocument(reviewCtx, company.id, type, `storage://fixtures/${randomUUID()}.jpg`, bytes);
      await upload('government_id');
      await upload('selfie_with_id');
      await upload('bir_cor');

      // Submitted: nothing is editable and nothing can be replaced.
      await expect(service.updateCompany(reviewCtx, company.id, { tin: '111-222-444' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(upload('bir_cor')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.reapply(reviewCtx, company.id)).rejects.toMatchObject({ response: { error: 'not_rejected' } });

      await service.decide(adminCtx, company.id, {
        decision: 'rejected',
        reason: 'bir_registration_invalid',
        note: 'The 2303 is from 2015 and the TIN is not on ORUS.',
        registryChecked: [],
        cureDocuments: [],
      });

      // Reapplying needs every cure paper uploaded since the rejection.
      await expect(service.reapply(reviewCtx, company.id)).rejects.toMatchObject({
        response: { error: 'cure_documents_missing', documentTypes: ['bir_cor', 'business_permit'] },
      });
      const fixed = await service.updateCompany(reviewCtx, company.id, { tin: '111-222-444' });
      expect(fixed.tin).toBe('111-222-444');
      await upload('bir_cor');
      await upload('business_permit');
      const reapplied = await service.reapply(reviewCtx, company.id);
      expect(reapplied.kycStatus).toBe('pending');
      // The reviewer still sees what it was rejected for.
      expect(reapplied.rejection?.reason).toBe('bir_registration_invalid');

      // The replaced 2303 no longer counts; the queue shows one of each.
      const [queued] = (await service.listForReview(adminCtx, 'pending')).items.filter((c) => c.id === company.id);
      expect(queued?.documents.map((d) => d.documentType).sort()).toEqual([
        'bir_cor',
        'business_permit',
        'government_id',
        'selfie_with_id',
      ]);

      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        const [note] = await sql`
          select payload from notifications
          where notification_type = 'company_rejected' and (payload->>'customer_id') = ${company.id}
        `;
        expect(note).toMatchObject({ payload: { reason: 'bir_registration_invalid' } });
      } finally {
        await sql.end();
      }

      // Approval only needs the live 2303 ticked, not the superseded one.
      await service.decide(adminCtx, company.id, {
        decision: 'approved',
        identity: IDENTITY,
        registryChecked: queued!.documents.filter((d) => d.documentType === 'bir_cor').map((d) => d.id),
        cureDocuments: [],
      });
      const [approved] = (await service.listForReview(adminCtx, 'approved')).items.filter((c) => c.id === company.id);
      expect(approved?.rejection).toBeNull();
    });

    it('writes the name the customer confirmed off the ID onto their account only on approval', async () => {
      const service = reviewer({
        first_name: { value: 'MARIA', confidence: 0.95 },
        last_name: { value: 'SANTOS', confidence: 0.95 },
      });
      const { companyId, secId } = await completeCompany('Named Corp');
      const company = { id: companyId };

      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        // Earlier approvals in this block wrote the same login's name.
        await sql`update users set first_name = null, middle_name = null, last_name = null where id = ${reviewCtx.userId}`;
        const before = await sql`select first_name from users where id = ${reviewCtx.userId}`;
        expect((before[0] as { first_name: string | null }).first_name).toBeNull();

        await service.decide(adminCtx, company.id, {
          decision: 'approved',
          identity: IDENTITY,
          registryChecked: [secId],
          cureDocuments: [],
        });

        const after =
          await sql`select first_name, middle_name, last_name from users where id = ${reviewCtx.userId}`;
        expect(after[0]).toMatchObject({
          first_name: 'Maria',
          middle_name: 'Reyes',
          last_name: 'Santos',
        });
      } finally {
        await sql.end();
      }
    });
  });
});
