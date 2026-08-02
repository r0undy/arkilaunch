import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { FixtureDocumentIntelligenceAdapter } from '@arkilaunch/shared';
import type { RequestContext } from '@arkilaunch/shared';
import { KycService } from '../src/kyc/kyc.service.js';
import { EventsService } from '../src/events/events.service.js';

// RFC-2 §2/§3 KYC sub-flow (PRD-F6). QAD-T6 (happy), QAD-T18 (sad: below
// threshold / portal mismatch stays unverified), QAD-T32 (abuse: no
// automated portal verification is ever attempted -- requiresHumanConfirmation
// is a hardcoded constant, not a computed one).
describe('KycService: extraction, format checks, and human portal confirmation', () => {
  let ctx: RequestContext;
  let customerId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} limit 1`;
    ctx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    customerId = (customer as { id: string }).id;
    await sql.end();
  });

  it('QAD-T6: extracts SEC/TIN, never auto-verifies, and always requires human confirmation', async () => {
    const fixture = new FixtureDocumentIntelligenceAdapter({
      fields: {
        sec_number: { value: 'CS202312345', confidence: 0.95 },
        tin: { value: '123-456-789', confidence: 0.93 },
      },
    });
    const kyc = new KycService(new EventsService(), fixture);

    const created = await kyc.extract(ctx, { customerId, documentType: 'sec_certificate', fileUri: 'storage://fixtures/sec.jpg' });
    expect(created.status).toBe('queued');

    const polled = await kyc.get(ctx, created.kycDocumentId);
    expect(polled.status).toBe('needs_review'); // never auto-accepted
    expect(polled.requiresHumanConfirmation).toBe(true);
    expect(polled.extracted.tin).toBe('123-456-789');
    expect(polled.formatValid.tin).toBe(true);
    expect(polled.formatValid.secNumber).toBe(true);

    const confirmed = await kyc.confirm(ctx, created.kycDocumentId, { registryStatus: 'active', portalMatchScore: 0.95 });
    expect(confirmed.status).toBe('verified');
    const afterConfirm = await kyc.get(ctx, created.kycDocumentId);
    expect(afterConfirm.matchBand).toBe('strong');
  });

  it('QAD-T18: a malformed TIN fails the format check but still routes to human review, never fabricated', async () => {
    const fixture = new FixtureDocumentIntelligenceAdapter({
      fields: {
        sec_number: { value: 'CS202312345', confidence: 0.95 },
        tin: { value: 'not-a-tin', confidence: 0.9 },
      },
    });
    const kyc = new KycService(new EventsService(), fixture);
    const created = await kyc.extract(ctx, { customerId, documentType: 'sec_certificate', fileUri: 'storage://fixtures/sec2.jpg' });
    const polled = await kyc.get(ctx, created.kycDocumentId);
    expect(polled.formatValid.tin).toBe(false);
    expect(polled.status).toBe('needs_review');
  });

  it('QAD-T18: a suspended/revoked registry status keeps the tenant unverified (rejected), never grants access', async () => {
    const fixture = new FixtureDocumentIntelligenceAdapter({
      fields: {
        sec_number: { value: 'CS202312345', confidence: 0.95 },
        tin: { value: '123-456-789', confidence: 0.95 },
      },
    });
    const kyc = new KycService(new EventsService(), fixture);
    const created = await kyc.extract(ctx, { customerId, documentType: 'sec_certificate', fileUri: 'storage://fixtures/sec3.jpg' });

    const confirmed = await kyc.confirm(ctx, created.kycDocumentId, { registryStatus: 'suspended', portalMatchScore: 0.2 });
    expect(confirmed.status).toBe('rejected');
    const polled = await kyc.get(ctx, created.kycDocumentId);
    expect(polled.matchBand).toBe('mismatch');
  });

  it('QAD-T32: unreadable/empty extraction never fabricates a SEC/TIN value', async () => {
    const emptyFixture = new FixtureDocumentIntelligenceAdapter({ fields: {} });
    const kyc = new KycService(new EventsService(), emptyFixture);
    const created = await kyc.extract(ctx, { customerId, documentType: 'sec_certificate', fileUri: 'storage://fixtures/empty.jpg' });
    const polled = await kyc.get(ctx, created.kycDocumentId);
    expect(polled.extracted.secNumber).toBeNull();
    expect(polled.extracted.tin).toBeNull();
    expect(polled.requiresHumanConfirmation).toBe(true);
  });
});
