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
import { ensurePaidDeposit } from './paid-deposit.js';

// A dedicated rental, so the ledger's exact numbers are deterministic whatever other specs left on the shared DB.
describe('BillingService (PRD-F2/F3 read surface)', () => {
  const billing = new BillingService();
  const edtr = new EdtrService(new EventsService());
  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let equipmentIdA: string;
  let depositRentalId: string;
  // Large enough that this file's own deductions never collide, far below test 2's over-the-cap attempt.
  const DEPOSIT_REQUIRED = 50000;

  beforeAll(async () => {
    // Fixtures are model-extracted, so attest a passing accuracy; money-path covers the unattested case.
    process.env.OCR_MEASURED_ACCURACY = '0.95';
    process.env.OCR_MEASURED_SAMPLES = '250';
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantIdA = (tenantA as { id: string }).id;
    const tenantIdB = (tenantB as { id: string }).id;
    const [adminA] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'admin@test-tenant-a.test'`;
    const [adminB] = await sql`select id from users where tenant_id = ${tenantIdB} and email = 'admin@test-tenant-b.test'`;
    // A type a rate card exists for; an unordered `limit 1` over the shared equipment table isn't stable.
    const [rateCardRow] = await sql`select equipment_type_id from rate_cards where tenant_id = ${tenantIdA} and equipment_id is null and rate_type = 'hourly' and (effective_to is null or effective_to > now()) order by effective_from limit 1`;
    const equipmentTypeIdA = (rateCardRow as { equipment_type_id: string }).equipment_type_id;
    const [customerA] = await sql`select id from customers where tenant_id = ${tenantIdA} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    const [siteA] = await sql`select id from project_sites where tenant_id = ${tenantIdA} limit 1`;

    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };

    // Dedicated, rate-carded unit and rental with a real contract deposit, isolated from other specs.
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
          // 2019, so the "no rate card in force" day below is inside the rental.
          startDate: new Date('2019-01-01T00:00:00Z'),
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
    await ensurePaidDeposit(adminCtxA, depositRentalId);

    await sql.end();
  });

  // Simulates the paper_ocr counterpart directly (same technique as
  // edtr-engine.spec.ts) so a digital_entry capture reconciles to 'matched'.
  async function insertExtractedPaperCounterpart(reportDate: string, hoursActive: number, hoursIdle: number, equipmentId = equipmentIdA) {
    return withTenantTx(adminCtxA, async (tx) => {
      const [row] = await tx
        .insert(edtrTable)
        .values({
          tenantId: adminCtxA.tenantId,
          rentalId: depositRentalId,
          equipmentId,
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

    // Pins the rate in force on report_date (850/hr), not quotes-engine's permanent newest 999999/hr card.
    expect(approved.deposit.deducted).toBe(4 * 850);

    const after = await billing.depositLedger(adminCtxA, depositRentalId);
    expect(after.totalDeducted).toBe(before.totalDeducted + approved.deposit.deducted);
    expect(after.balanceRemaining).toBe(DEPOSIT_REQUIRED - after.totalDeducted);
    expect(after.balanceRemaining).toBeLessThan(before.balanceRemaining!);
  });

  it('rejects an approve where no rate card was in force on the report date, instead of deducting at zero', async () => {
    // Cards exist for this type but none covers 2019; this must not silently price at 0.
    const reportDate = '2019-06-01';
    await insertExtractedPaperCounterpart(reportDate, 3, 0);
    const digital = await edtr.capture(adminCtxA, {
      source: 'digital_entry',
      rentalId: depositRentalId,
      equipmentId: equipmentIdA,
      reportDate,
      lineItems: { hoursActive: 3, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtxA, digital.id);
    expect(polled.reconciliation?.status).toBe('matched');

    const before = await billing.depositLedger(adminCtxA, depositRentalId);
    await expect(edtr.approve(adminCtxA, digital.id, { reconciliationId: polled.reconciliation!.id })).rejects.toMatchObject({
      response: { error: 'rate_card_not_effective' },
    });
    // Fails closed: no deduction, no invoice, ledger untouched.
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

    const invoice = await billing.getInvoice(adminCtxA, approved.invoiceLine.invoiceId!);
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

  it('GET /invoices date filters are Manila days', async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const [row] = await sql`
      insert into invoices (tenant_id, rental_id, invoice_type, amount, status, due_date, created_at)
      values (${adminCtxA.tenantId}, ${depositRentalId}, 'deposit', 0, 'void', '2026-08-31T23:00:00Z', '2026-08-31T23:00:00Z')
      returning id`;
    await sql.end();
    const id = (row as { id: string }).id;
    const list = (from: string, to: string) =>
      billing.listInvoices(adminCtxA, { rentalId: depositRentalId, from, to, limit: 50, offset: 0 }).then((r) => r.items.map((i) => i.id));

    expect(await list('2026-09-01', '2026-09-01')).toContain(id);
    expect(await list('2026-08-31', '2026-08-31')).not.toContain(id);
  });

  // QAD-T23: cross-tenant read is denied by RLS itself, not an app-level filter.
  it('QAD-T23: a tenant B admin cannot read tenant A rental deposit ledger or invoices', async () => {
    await expect(billing.depositLedger(adminCtxB, depositRentalId)).rejects.toThrow(NotFoundException);

    const { items } = await billing.listInvoices(adminCtxA, { rentalId: depositRentalId, limit: 50, offset: 0 });
    const invoiceId = items[0]!.id;
    await expect(billing.getInvoice(adminCtxB, invoiceId)).rejects.toThrow(NotFoundException);
  });
  it('rejects an approve for a type whose only card is non-hourly, and posts no invoice', async () => {
    const url = process.env.DATABASE_URL_DIRECT!;
    const sql = postgres(url, { max: 1 });
    try {
      const [type] = await sql`insert into equipment_types (name) values (${`Daily Only Type ${Date.now()}`}) returning id`;
      const typeId = (type as { id: string }).id;
      const [unit] = await sql`
        insert into equipment (tenant_id, equipment_type_id, model, serial_no)
        values (${adminCtxA.tenantId}, ${typeId}, 'Daily Only Unit', ${`test-tenant-a-serial-daily-${Date.now()}`}) returning id
      `;
      const unitId = (unit as { id: string }).id;
      const insertDaily = sql`
        insert into rate_cards (tenant_id, equipment_type_id, rate_type, rate_value, currency, effective_from)
        values (${adminCtxA.tenantId}, ${typeId}, 'daily', 8000.00, 'PHP', '2020-01-01')
      `;
      const [chk] = await sql`select 1 from pg_constraint where conname = 'rate_cards_hourly_only_chk'`;
      // Once 0071 is applied a daily card can only be a legacy row, so the CHECK itself is the guard.
      if (chk) {
        await expect(insertDaily).rejects.toMatchObject({ code: '23514' });
        return;
      }
      await insertDaily;

      const reportDate = '2021-05-04';
      await insertExtractedPaperCounterpart(reportDate, 3, 0, unitId);
      const digital = await edtr.capture(adminCtxA, {
        source: 'digital_entry',
        rentalId: depositRentalId,
        equipmentId: unitId,
        reportDate,
        lineItems: { hoursActive: 3, hoursIdle: 0 },
      });
      const polled = await edtr.get(adminCtxA, digital.id);
      expect(polled.reconciliation?.status).toBe('matched');

      const before = await billing.depositLedger(adminCtxA, depositRentalId);
      const invoicesBefore = await billing.listInvoices(adminCtxA, { rentalId: depositRentalId, limit: 50, offset: 0 });
      await expect(edtr.approve(adminCtxA, digital.id, { reconciliationId: polled.reconciliation!.id })).rejects.toMatchObject({
        response: { error: 'rate_card_not_effective' },
      });
      const after = await billing.depositLedger(adminCtxA, depositRentalId);
      expect(after.totalDeducted).toBe(before.totalDeducted);
      const invoicesAfter = await billing.listInvoices(adminCtxA, { rentalId: depositRentalId, limit: 50, offset: 0 });
      expect(invoicesAfter.total).toBe(invoicesBefore.total);
    } finally {
      await sql.end();
    }
  });

  // Last in the file: it takes this rental's deposit to zero.
  it('an approve past the deposit deducts what is left and accrues the rest', async () => {
    const reportDate = '2021-05-02';
    // 4000 hours * 850/hr far exceeds the remaining balance.
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
    const approved = await edtr.approve(adminCtxA, digital.id, { reconciliationId: polled.reconciliation!.id });
    expect(approved.deposit.deducted).toBe(before.balanceRemaining);
    expect(approved.deposit.accrued).toBe(4000 * 850 - before.balanceRemaining!);
    expect(approved.deposit.balanceAfter).toBe(0);

    const after = await billing.depositLedger(adminCtxA, depositRentalId);
    expect(after.balanceRemaining).toBe(0);
    expect(after.unbilledAccrued).toBe(approved.deposit.accrued);
    expect(after.hoursUsed - before.hoursUsed).toBeCloseTo(4000, 1);
  });
});
