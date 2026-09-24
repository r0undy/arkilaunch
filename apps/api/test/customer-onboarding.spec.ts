import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { EventsService } from '../src/events/events.service.js';
import { JwtService } from '@nestjs/jwt';

// Customer prerequisites CR: a stranger signs up, adds a company and a
// site, books, and cannot pay until staff verify the company. One login
// may own several companies; no one else can use them.
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
  const bookings = new BookingsService(events);
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
    // Signup lands in the storefront tenant; point it at the fixture.
    process.env.ANCHOR_TENANT_SLUG = 'test-tenant-a';
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
    });
    const ctx = decodeCtx(tokens.accessToken);
    expect(ctx).toMatchObject({ tenantId, role: 'customer' });

    // The same email cannot sign up twice, in any tenant.
    await expect(
      auth.registerCustomer({ email, password: 'another long password', acceptedTerms: true }),
    ).rejects.toBeInstanceOf(ConflictException);

    const details = {
      tin: '123-456-789',
      billingAddress: '1248 North Quarry Way, Pasig',
      contactMobile: '09170000000',
    };
    const acme = await companies.createCompany(ctx, {
      companyName: 'Acme Builders',
      secNumber: 'PH62780901',
      ...details,
    });
    // The card shows this as "Registration Number" (Figma 251:1945).
    expect(acme.secNumber).toBe('PH62780901');
    expect((await companies.listCompanies(ctx)).find((c) => c.id === acme.id)?.secNumber).toBe(
      'PH62780901',
    );
    const beta = await companies.createCompany(ctx, { companyName: 'Beta Works', ...details });
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

    const booking = await bookings.create(ctx, {
      customerId: acme.id,
      projectSiteId: site.id,
      items: [{ equipmentId, ...window(0) }],
    });
    expect((await bookings.list(ctx, { limit: 10, offset: 0 })).items.map((b) => b.id)).toContain(
      booking.id,
    );

    // Unverified: no payment. Verified by staff: payment opens.
    await expect(payments.checkout(ctx, booking.id)).rejects.toMatchObject({
      response: { error: 'company_not_verified' },
    });
    const queue = await companies.listForReview(adminCtx, 'pending');
    expect(queue.find((c) => c.id === acme.id)?.documents).toHaveLength(1);
    await companies.decide(adminCtx, acme.id, { decision: 'approved' });
    const checkout = await payments.checkout(ctx, booking.id);
    expect(checkout.checkoutUrl).toContain('about:blank');

    await bookings.cancel(ctx, booking.id);
  });

  it('keeps one customer out of another’s companies and sites, and other tenants out entirely', async () => {
    const tokens = await auth.registerCustomer({
      email: `signup-${randomUUID().slice(0, 8)}@onboarding.test`,
      password: 'correct horse battery',
      acceptedTerms: true,
    });
    const ctx = decodeCtx(tokens.accessToken);
    const mine = await companies.createCompany(ctx, {
      companyName: 'Gamma Corp',
      tin: '123456789',
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

    // The company card fetches its own registration certificate through
    // ownDocumentKey(). RLS bounds the tenant and no further -- without the
    // ownership predicate on top, this read is one customer of a tenant
    // pulling another's KYC evidence by guessing a customer id.
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
    // A staff login -- of this tenant or another -- never reaches the
    // ownership check at all: this route is the customer's own, and
    // assertCustomer refuses the role first. Staff read the same document
    // through the quote:approve route, which is audited.
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
      (await companies.listForReview(otherTenantCtx, 'pending')).map((c) => c.id),
    ).not.toContain(mine.id);
    await expect(
      companies.decide(otherTenantCtx, mine.id, { decision: 'approved' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });


  // The browse page's weather rail reads this. It is the first weather route
  // a customer can reach at all -- the two on sites.controller.ts are
  // STAFF_READ -- so the isolation is new surface, not a variation on old.
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
        tin: '123-456-789',
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
      });
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

    // RLS bounds the tenant and no further, and `customer` is an intra-tenant
    // role: without ownCustomers() on top, this read tells one customer where
    // another company is working.
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
        address: '12 Yard Road, Cebu City',
        tin: null,
        dtiNumber: null,
      });
      // The address is free text and does not drag legibility down.
      expect(sec.confidence).toBeCloseTo(0.9);
      expect(sec.extractionAvailable).toBe(true);

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
      });
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

  // Admin-side review: OCR fills the reviewer's form in, the reviewer
  // corrects it, and approval writes what they confirmed. Nothing here
  // decides anything on the extraction's own.
  describe('staff document review', () => {
    const reviewer = (fields: Record<string, { value: string; confidence: number }>) =>
      new CustomersService(events, new FixtureDocumentIntelligenceAdapter({ fields }));
    const bytes = Buffer.from('not-really-an-image');
    // Its own customer, never the module-wide seeded one: this block
    // creates many companies per test run, and bookings.create()'s
    // implicit-company selection elsewhere (payments-engine.spec.ts et al.)
    // breaks the instant the shared seeded customer owns more than one.
    let reviewCtx: RequestContext;

    beforeAll(async () => {
      const tokens = await auth.registerCustomer({
        email: `staff-review-${randomUUID().slice(0, 8)}@onboarding.test`,
        password: 'correct horse battery',
        acceptedTerms: true,
      });
      reviewCtx = decodeCtx(tokens.accessToken);
    });

    async function companyWithRegistration(name: string, documentType = 'sec_certificate') {
      const company = await companies.createCompany(reviewCtx, {
        companyName: name,
        tin: '111-222-333',
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
        .then((all) => all.filter((c) => c.id === companyId));
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

    it('writes the corrections the reviewer confirmed when approving', async () => {
      const { companyId, documentId } = await companyWithRegistration('Typo Corp');
      await companies.decide(adminCtx, companyId, {
        decision: 'approved',
        companyName: 'Typo Construction Corporation',
        tin: '123-456-789',
        secNumber: 'CS202312345',
        registryChecked: [documentId],
      });
      const approved = (await companies.listForReview(adminCtx, 'approved')).find(
        (c) => c.id === companyId,
      );
      expect(approved?.companyName).toBe('Typo Construction Corporation');
      expect(approved?.tin).toBe('123-456-789');
      expect(approved?.secNumber).toBe('CS202312345');
      expect(approved?.documents[0]?.registryChecked).toBe(true);
    });

    it('refuses approval until every SEC/BIR/DTI paper is ticked as checked on its registry', async () => {
      const { companyId, documentId } = await companyWithRegistration('Unchecked Corp');
      const dti = await companies.addDocument(
        reviewCtx,
        companyId,
        'dti_certificate',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      await expect(
        companies.decide(adminCtx, companyId, { decision: 'approved', registryChecked: [documentId] }),
      ).rejects.toMatchObject({
        response: { error: 'registry_check_required', documentTypes: ['dti_certificate'] },
      });
      // Rejecting needs no registry check.
      await companies.decide(adminCtx, companyId, { decision: 'rejected' });
      const rejected = (await companies.listForReview(adminCtx, 'rejected')).find((c) => c.id === companyId);
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
        (await companies.listForReview(adminCtx, 'pending'))
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

    it('leaves the company alone when the reviewer rejects it', async () => {
      const { companyId } = await companyWithRegistration('Reject Corp');
      await companies.decide(adminCtx, companyId, {
        decision: 'rejected',
        companyName: 'Should Not Be Written',
      });
      const rejected = (await companies.listForReview(adminCtx, 'rejected')).find(
        (c) => c.id === companyId,
      );
      expect(rejected?.companyName).toBe('Reject Corp');
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
        tin: '111-222-333',
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

    it('locks a submitted company until the reviewer unlocks a field, and keeps it pending', async () => {
      const service = reviewer({ tin: { value: '111-222-333', confidence: 0.95 } });
      const company = await service.createCompany(reviewCtx, {
        companyName: 'Locked Corp',
        tin: '111-222-333',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const upload = (type: string) =>
        service.addDocument(reviewCtx, company.id, type, `storage://fixtures/${randomUUID()}.jpg`, bytes);
      await upload('government_id');
      await upload('bir_cor');

      // Submitted: nothing is editable and nothing can be replaced.
      await expect(service.updateCompany(reviewCtx, company.id, { tin: '111-222-444' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(upload('bir_cor')).rejects.toBeInstanceOf(ConflictException);

      const commented = await service.comment(adminCtx, company.id, {
        comment: 'The TIN is one digit off, and the 2303 is cut off.',
        unlock: ['tin', 'bir_cor'],
      });
      expect(commented.kycStatus).toBe('pending');

      // Only what was unlocked, once each.
      await expect(
        service.updateCompany(reviewCtx, company.id, { billingAddress: '1 Other St, Cebu City' }),
      ).rejects.toBeInstanceOf(ConflictException);
      const fixed = await service.updateCompany(reviewCtx, company.id, { tin: '111-222-444' });
      expect(fixed.tin).toBe('111-222-444');
      expect(fixed.kycStatus).toBe('pending');
      expect(fixed.unlockedFields).toEqual(['bir_cor']);
      await upload('bir_cor');
      await expect(upload('bir_cor')).rejects.toBeInstanceOf(ConflictException);

      // The replaced 2303 no longer counts; the queue shows one of each.
      const [queued] = (await service.listForReview(adminCtx, 'pending')).filter((c) => c.id === company.id);
      expect(queued?.documents.map((d) => d.documentType).sort()).toEqual(['bir_cor', 'government_id']);
      expect(queued?.reviewComment).toBe('The TIN is one digit off, and the 2303 is cut off.');
      expect(queued?.unlockedFields).toEqual([]);

      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        const [note] = await sql`
          select payload from notifications
          where notification_type = 'company_review_comment' and (payload->>'company_id') = ${company.id}
        `;
        expect(note).toBeDefined();
      } finally {
        await sql.end();
      }

      // Approval only needs the live 2303 ticked, not the superseded one.
      await service.decide(adminCtx, company.id, {
        decision: 'approved',
        registryChecked: queued!.documents.filter((d) => d.documentType === 'bir_cor').map((d) => d.id),
      });
    });

    it('writes the reviewer-confirmed name onto the customer account only on approval', async () => {
      const service = reviewer({
        first_name: { value: 'MARIA', confidence: 0.95 },
        last_name: { value: 'SANTOS', confidence: 0.95 },
      });
      const company = await service.createCompany(reviewCtx, {
        companyName: 'Named Corp',
        tin: '111-222-333',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });

      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        const before = await sql`select first_name from users where id = ${reviewCtx.userId}`;
        expect((before[0] as { first_name: string | null }).first_name).toBeNull();

        await service.decide(adminCtx, company.id, {
          decision: 'approved',
          firstName: 'Maria',
          middleName: 'Reyes',
          lastName: 'Santos',
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
