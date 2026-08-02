import { describe, expect, it, beforeAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import {
  edtr as edtrTable,
  edtrLineItems,
  equipment as equipmentTable,
  quotations,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { BillingService } from '../src/billing/billing.service.js';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';

// PRD-F2/F3 read surface backing S9 Billing & Deposit Ledger
// (cr-arkilaunch-f9-read-surface.md). Uses a dedicated rental (not the
// shared fixture rental other spec files deduct against) so the ledger's
// exact numbers are deterministic under cross-file test concurrency.
describe('BillingService (PRD-F2/F3 read surface)', () => {
  const billing = new BillingService();
  const edtr = new EdtrService(new EventsService());
  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let equipmentIdA: string;
  let depositRentalId: string;
  // Large enough that the file's own smaller deductions (test 1: 3400,
  // evidence-trail test: 1700) never collide with each other across the
  // shared depositRentalId, while still far below test 2's deliberate
  // 4000-hour (PHP 3,400,000) over-the-cap attempt.
  const DEPOSIT_REQUIRED = 50000;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantIdA = (tenantA as { id: string }).id;
    const tenantIdB = (tenantB as { id: string }).id;
    const [adminA] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'admin@test-tenant-a.test'`;
    const [adminB] = await sql`select id from users where tenant_id = ${tenantIdB} and email = 'admin@test-tenant-b.test'`;
    // The equipment_type_id a rate card actually exists for (rate_cards is
    // keyed by tenant+type, exactly one row per test-tenant seeded).
    // Deliberately NOT `select ... from equipment ... limit 1`: this live,
    // never-reset test project accumulates equipment rows from other spec
    // files' runs (e.g. fleet-engine.spec.ts's own equipment_types lookup
    // has the same unscoped-limit-1 shape and can resolve to a type with no
    // rate card), and an unordered `limit 1` over a growing table is not
    // guaranteed to return the same row every run.
    const [rateCardRow] = await sql`select equipment_type_id from rate_cards where tenant_id = ${tenantIdA} limit 1`;
    const equipmentTypeIdA = (rateCardRow as { equipment_type_id: string }).equipment_type_id;
    const [customerA] = await sql`select id from customers where tenant_id = ${tenantIdA} limit 1`;
    const [siteA] = await sql`select id from project_sites where tenant_id = ${tenantIdA} limit 1`;

    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };

    // A dedicated equipment unit (correctly rate-carded) and rental with
    // its own quotation + rental_contracts chain (depositRequired=5000) so
    // resolveDepositLedger has a real cap to measure against, and the
    // deduction math is self-contained -- distinct from the shared fixture
    // rental/equipment other spec files mutate concurrently.
    await withTenantTx(adminCtxA, async (tx) => {
      const [equipmentRow] = await tx
        .insert(equipmentTable)
        .values({
          tenantId: tenantIdA,
          equipmentTypeId: equipmentTypeIdA,
          model: 'Billing Test Unit',
          serialNo: `test-tenant-a-serial-billing-${Date.now()}`,
        })
        .returning();
      equipmentIdA = equipmentRow!.id;

      const [rental] = await tx
        .insert(rentals)
        .values({
          tenantId: tenantIdA,
          customerId: (customerA as { id: string }).id,
          projectSiteId: (siteA as { id: string }).id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      depositRentalId = rental!.id;

      const [quotation] = await tx
        .insert(quotations)
        .values({ tenantId: tenantIdA, customerId: (customerA as { id: string }).id, rentalId: depositRentalId })
        .returning();
      await tx.insert(rentalContracts).values({
        tenantId: tenantIdA,
        quotationId: quotation!.id,
        depositRequired: String(DEPOSIT_REQUIRED),
      });
    });

    await sql.end();
  });

  // Simulates the paper_ocr counterpart directly (same technique as
  // edtr-engine.spec.ts) so a digital_entry capture reconciles to 'matched'.
  async function insertExtractedPaperCounterpart(reportDate: string, hoursActive: number, hoursIdle: number) {
    return withTenantTx(adminCtxA, async (tx) => {
      const [row] = await tx
        .insert(edtrTable)
        .values({
          tenantId: adminCtxA.tenantId,
          rentalId: depositRentalId,
          equipmentId: equipmentIdA,
          source: 'paper_ocr',
          reportDate,
          rawFileUri: 'storage://fixtures/billing-counterpart.jpg',
          status: 'extracted',
          ocrPayload: {
            model_id: 'test-fixture',
            api_version: 'test',
            analyzed_at: new Date().toISOString(),
            fields: [
              { name: 'hours_active', value: hoursActive, value_type: 'number', confidence: 0.97 },
              { name: 'hours_idle', value: hoursIdle, value_type: 'number', confidence: 0.96 },
            ],
            min_field_confidence: 0.96,
            pages: 1,
          },
        })
        .returning();
      await tx.insert(edtrLineItems).values({
        tenantId: adminCtxA.tenantId,
        edtrId: row!.id,
        hoursActive: String(hoursActive),
        hoursIdle: String(hoursIdle),
      });
      return row!.id;
    });
  }

  it('a configured deposit reports a decreasing balanceRemaining as deductions are approved', async () => {
    const before = await billing.depositLedger(adminCtxA, depositRentalId);
    expect(before.depositRequired).toBe(DEPOSIT_REQUIRED);
    expect(before.balanceRemaining).toBe(DEPOSIT_REQUIRED - before.totalDeducted);

    const reportDate = '2021-05-01';
    await insertExtractedPaperCounterpart(reportDate, 4, 0);
    const digital = await edtr.capture(adminCtxA, {
      source: 'digital_entry',
      rentalId: depositRentalId,
      equipmentId: equipmentIdA,
      reportDate,
      lineItems: { hoursActive: 4, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtxA, digital.id);
    expect(polled.reconciliation?.status).toBe('matched');
    const approved = await edtr.approve(adminCtxA, digital.id, { reconciliationId: polled.reconciliation!.id });

    const after = await billing.depositLedger(adminCtxA, depositRentalId);
    expect(after.totalDeducted).toBe(before.totalDeducted + approved.deposit.deducted);
    expect(after.balanceRemaining).toBe(DEPOSIT_REQUIRED - after.totalDeducted);
    expect(after.balanceRemaining).toBeLessThan(before.balanceRemaining!);
  });

  it('cr-arkilaunch-f9-read-surface.md fix: an approve that would exceed the deposit is rejected 409 deposit_exhausted, deducting nothing', async () => {
    const reportDate = '2021-05-02';
    // 4000 hours * 850/hr far exceeds the remaining balance of a 5000 cap.
    await insertExtractedPaperCounterpart(reportDate, 4000, 0);
    const digital = await edtr.capture(adminCtxA, {
      source: 'digital_entry',
      rentalId: depositRentalId,
      equipmentId: equipmentIdA,
      reportDate,
      lineItems: { hoursActive: 4000, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtxA, digital.id);
    expect(polled.reconciliation?.status).toBe('matched');

    const before = await billing.depositLedger(adminCtxA, depositRentalId);
    await expect(edtr.approve(adminCtxA, digital.id, { reconciliationId: polled.reconciliation!.id })).rejects.toMatchObject({
      response: { error: 'deposit_exhausted' },
    });
    const after = await billing.depositLedger(adminCtxA, depositRentalId);
    expect(after.totalDeducted).toBe(before.totalDeducted);
  });

  it('GET /invoices/:id returns the EDTR evidence trail (both source logs) and the DEDUCT audit entry', async () => {
    const reportDate = '2021-05-03';
    const paperId = await insertExtractedPaperCounterpart(reportDate, 2, 0);
    const digital = await edtr.capture(adminCtxA, {
      source: 'digital_entry',
      rentalId: depositRentalId,
      equipmentId: equipmentIdA,
      reportDate,
      lineItems: { hoursActive: 2, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtxA, digital.id);
    const approved = await edtr.approve(adminCtxA, digital.id, { reconciliationId: polled.reconciliation!.id });

    const invoice = await billing.getInvoice(adminCtxA, approved.invoiceLine.invoiceId);
    expect(invoice.invoiceType).toBe('deposit_deduction');
    expect(invoice.edtrEvidence).not.toBeNull();
    expect(invoice.edtrEvidence!.sourceEdtrIds).toEqual(expect.arrayContaining([digital.id, paperId]));
    expect(invoice.edtrEvidence!.status).toBe('approved');
    expect(invoice.auditTrail.some((entry) => entry.action === 'DEDUCT')).toBe(true);
  });

  it('GET /invoices filters by rentalId and invoiceType', async () => {
    const { items, total } = await billing.listInvoices(adminCtxA, {
      rentalId: depositRentalId,
      invoiceType: 'deposit_deduction',
      limit: 50,
      offset: 0,
    });
    expect(total).toBeGreaterThan(0);
    expect(items.every((item) => item.rentalId === depositRentalId && item.invoiceType === 'deposit_deduction')).toBe(true);
  });

  // QAD-T23: cross-tenant read is denied by RLS itself, not an app-level filter.
  it('QAD-T23: a tenant B admin cannot read tenant A rental deposit ledger or invoices', async () => {
    await expect(billing.depositLedger(adminCtxB, depositRentalId)).rejects.toThrow(NotFoundException);

    const { items } = await billing.listInvoices(adminCtxA, { rentalId: depositRentalId, limit: 50, offset: 0 });
    const invoiceId = items[0]!.id;
    await expect(billing.getInvoice(adminCtxB, invoiceId)).rejects.toThrow(NotFoundException);
  });
});
