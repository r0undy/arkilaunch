import { describe, expect, it, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import {
  ExtractionUnavailableError,
  StubPaymentsAdapter,
  UnavailableDocumentIntelligenceAdapter,
  type RequestContext,
} from '@arkilaunch/shared';
import { FixtureDocumentIntelligenceAdapter } from '@arkilaunch/shared/testing';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { CustomersService } from '../src/customers/customers.service.js';
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
    const acme = await companies.createCompany(ctx, { companyName: 'Acme Builders', ...details });
    const beta = await companies.createCompany(ctx, { companyName: 'Beta Works', ...details });
    expect((await companies.listCompanies(ctx)).map((c) => c.companyName).sort()).toEqual([
      'Acme Builders',
      'Beta Works',
    ]);

    await companies.addDocument(ctx, acme.id, 'government_id', `${tenantId}/test/id.jpg`);
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
      companies.addDocument(seededCustomerCtx, mine.id, 'government_id', 'x'),
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

  // Scan-first onboarding: the scan only fills the form in. It must not
  // write a document row or decide anything -- staff still review.
  describe('company document scan', () => {
    const scanner = (fields: Record<string, { value: string; confidence: number }>) =>
      new CustomersService(events, new FixtureDocumentIntelligenceAdapter({ fields }));
    const bytes = Buffer.from('not-really-an-image');

    it('suggests what it read, for the customer to correct', async () => {
      const service = scanner({
        company_name: { value: 'Almara Construction Corporation', confidence: 0.9 },
        tin: { value: '123-456-789', confidence: 0.93 },
        sec_number: { value: 'CS202312345', confidence: 0.95 },
      });
      const scan = await service.scanDocument(seededCustomerCtx, bytes);
      expect(scan.suggestions).toEqual({
        companyName: 'Almara Construction Corporation',
        tin: '123-456-789',
        secNumber: 'CS202312345',
      });
      expect(scan.extractionAvailable).toBe(true);
    });

    it('drops a value that fails its format check rather than suggesting it', async () => {
      const service = scanner({
        tin: { value: 'not-a-tin', confidence: 0.99 },
        sec_number: { value: '??', confidence: 0.99 },
      });
      const scan = await service.scanDocument(seededCustomerCtx, bytes);
      expect(scan.suggestions.tin).toBeNull();
      expect(scan.suggestions.secNumber).toBeNull();
    });

    it('says so instead of inventing values when no extractor is available', async () => {
      const scan = await companies.scanDocument(seededCustomerCtx, bytes);
      expect(scan).toEqual({
        suggestions: { companyName: null, tin: null, secNumber: null },
        extractionAvailable: false,
      });
    });

    it('writes nothing: no document row, no verification decision', async () => {
      const service = scanner({ tin: { value: '123-456-789', confidence: 0.93 } });
      const url = process.env.DATABASE_URL_DIRECT!;
      const sql = postgres(url, { max: 1 });
      const before = await sql`select count(*)::int as n from kyc_documents`;
      await service.scanDocument(seededCustomerCtx, bytes);
      const after = await sql`select count(*)::int as n from kyc_documents`;
      await sql.end();
      expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n);
    });

    it("refuses a staff role: this is the customer's own typing aid", async () => {
      const service = scanner({ tin: { value: '123-456-789', confidence: 0.93 } });
      await expect(service.scanDocument(adminCtx, bytes)).rejects.toBeInstanceOf(
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

    async function companyWithRegistration(name: string) {
      const company = await companies.createCompany(seededCustomerCtx, {
        companyName: name,
        tin: '111-222-333',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const doc = await companies.addDocument(
        seededCustomerCtx,
        company.id,
        'company_registration',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      return { companyId: company.id, documentId: doc.id };
    }

    it('reads the document onto the row without deciding anything', async () => {
      const { companyId, documentId } = await companyWithRegistration('Reviewme Corp');
      const service = reviewer({
        company_name: { value: 'REVIEWME CORPORATION', confidence: 0.88 },
        tin: { value: '123-456-789', confidence: 0.93 },
        sec_number: { value: 'CS202312345', confidence: 0.95 },
      });

      const read = await service.readDocument(adminCtx, companyId, documentId, bytes);
      expect(read.suggestions.companyName).toBe('REVIEWME CORPORATION');
      expect(read.formatValid).toEqual({ tin: true, secNumber: true });
      // The weakest field, not the strongest.
      expect(read.confidence).toBeCloseTo(0.88);

      const [company] = await companies
        .listForReview(adminCtx, 'pending')
        .then((all) => all.filter((c) => c.id === companyId));
      expect(company?.kycStatus).toBe('pending'); // unchanged by reading
      expect(company?.companyName).toBe('Reviewme Corp'); // not overwritten by OCR
    });

    it('reports a malformed value as invalid instead of hiding it', async () => {
      const { companyId, documentId } = await companyWithRegistration('Badformat Corp');
      const service = reviewer({ tin: { value: '12-34', confidence: 0.91 } });
      const read = await service.readDocument(adminCtx, companyId, documentId, bytes);
      expect(read.suggestions.tin).toBe('12-34');
      expect(read.formatValid.tin).toBe(false);
    });

    it('writes the corrections the reviewer confirmed when approving', async () => {
      const { companyId } = await companyWithRegistration('Typo Corp');
      await companies.decide(adminCtx, companyId, {
        decision: 'approved',
        companyName: 'Typo Construction Corporation',
        tin: '123-456-789',
        secNumber: 'CS202312345',
      });
      const approved = (await companies.listForReview(adminCtx, 'approved')).find(
        (c) => c.id === companyId,
      );
      expect(approved?.companyName).toBe('Typo Construction Corporation');
      expect(approved?.tin).toBe('123-456-789');
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

    it('screens a National ID at upload time: legible reaches the queue, illegible is bounced back', async () => {
      const legible = reviewer({
        first_name: { value: 'JUAN', confidence: 0.95 },
        middle_name: { value: 'MERCADO', confidence: 0.93 },
        last_name: { value: 'DELA CRUZ', confidence: 0.96 },
      });
      const legibleCompany = await legible.createCompany(seededCustomerCtx, {
        companyName: 'Legible Scan Corp',
        tin: '111-222-333',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const legibleDoc = await legible.addDocument(
        seededCustomerCtx,
        legibleCompany.id,
        'government_id',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      expect(legibleDoc.status).toBe('needs_review');

      const illegible = reviewer({
        first_name: { value: 'J', confidence: 0.4 },
      });
      const illegibleCompany = await illegible.createCompany(seededCustomerCtx, {
        companyName: 'Blurry Scan Corp',
        tin: '111-222-333',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });
      const illegibleDoc = await illegible.addDocument(
        seededCustomerCtx,
        illegibleCompany.id,
        'government_id',
        `storage://fixtures/${randomUUID()}.jpg`,
        bytes,
      );
      expect(illegibleDoc.status).toBe('resubmit_required');

      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        const [note] = await sql`
          select payload from notifications
          where notification_type = 'document_resubmit_required'
            and (payload->>'company_id') = ${illegibleCompany.id}
        `;
        expect(note).toBeDefined();
        expect((note as { payload: { document_type: string } }).payload.document_type).toBe(
          'government_id',
        );
      } finally {
        await sql.end();
      }
    });

    it('writes the reviewer-confirmed name onto the customer account only on approval', async () => {
      const service = reviewer({
        first_name: { value: 'MARIA', confidence: 0.95 },
        last_name: { value: 'SANTOS', confidence: 0.95 },
      });
      const company = await service.createCompany(seededCustomerCtx, {
        companyName: 'Named Corp',
        tin: '111-222-333',
        billingAddress: '12 Yard Road, Cebu City',
        contactMobile: '0917 000 0000',
      });

      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      try {
        const before = await sql`select first_name from users where id = ${seededCustomerCtx.userId}`;
        expect((before[0] as { first_name: string | null }).first_name).toBeNull();

        await service.decide(adminCtx, company.id, {
          decision: 'approved',
          firstName: 'Maria',
          middleName: 'Reyes',
          lastName: 'Santos',
        });

        const after =
          await sql`select first_name, middle_name, last_name from users where id = ${seededCustomerCtx.userId}`;
        expect(after[0]).toMatchObject({
          first_name: 'Maria',
          middle_name: 'Reyes',
          last_name: 'Santos',
        });
      } finally {
        // Leave the shared seed fixture as this spec found it.
        await sql`update users set first_name = null, middle_name = null, last_name = null where id = ${seededCustomerCtx.userId}`;
        await sql.end();
      }
    });
  });
});
