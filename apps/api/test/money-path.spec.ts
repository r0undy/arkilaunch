import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import {
  depositAccruals,
  edtr as edtrTable,
  edtrLineItems,
  edtrReconciliations,
  getBillingSettings,
  invoices as invoicesTable,
  invoiceLineItems,
  quotations,
  reconcileEdtr,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';
import { ensurePaidDeposit } from './paid-deposit.js';

// QAD-T26 / QAD-T40, run by name in the money-path-e2e CI job. Assertions are about money NOT moving.
describe('the money path: no deduction without a passing reconciliation', () => {
  const edtr = new EdtrService(new EventsService());
  let adminCtx: RequestContext;
  let rentalId: string;
  let equipmentId: string;
  // No quotation/rental_contracts chain, for the no-deposit fallback cap.
  let uncappedRentalId: string;
  let unpaidRentalId: string;
  let uncappedEquipmentId: string;

  // Own date range: suites share equipment, so overlapping days pair across suites.
  // Taken: 2020-02-0X (billing), 2021-03-01..10 (edtr-engine), 2021-04-01..02 (ai-abuse), 2021-05-01..03 (fleet).
  const DATES = {
    swap: '2021-06-01',
    asymmetric: '2021-06-02',
    refused: '2021-06-03',
    match: '2021-06-04',
    noEvidence: '2021-06-05',
    modelSourced: '2021-06-06',
    uncapped: '2021-06-07',
    unpaid: '2021-06-08',
  };

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`
      select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'
    `;
    const [equipment] = await sql`select id from equipment where tenant_id = ${tenantId} limit 1`;

    // Its own equipment type: a card on the shared type would reprice every other spec's deductions.
    const [cappedType] = await sql`
      insert into equipment_types (name) values (${`Money Path Cap Fixture ${Date.now()}`}) returning id
    `;
    const cappedTypeId = (cappedType as { id: string }).id;
    const [cappedEquipment] = await sql`
      insert into equipment (tenant_id, equipment_type_id, model, serial_no)
      values (${tenantId}, ${cappedTypeId}, 'Money Path Cap Unit', ${`test-tenant-a-serial-cap-${Date.now()}`})
      returning id
    `;
    uncappedEquipmentId = (cappedEquipment as { id: string }).id;
    await sql`
      insert into rate_cards (tenant_id, equipment_type_id, rate_type, rate_value, currency, effective_from, effective_to)
      values (${tenantId}, ${cappedTypeId}, 'hourly', 1000.00, 'PHP', '2021-01-01', '2021-12-31')
    `;
    const [customerRow] = await sql`select id from customers where tenant_id = ${tenantId} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    const [siteRow] = await sql`select id from project_sites where tenant_id = ${tenantId} limit 1`;

    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    equipmentId = (equipment as { id: string }).id;

    // Fixed dates, so a prior run's rows would pair as stale counterparts.
    const dates = Object.values(DATES);
    const staleIds = await sql`
      select id from edtr where equipment_id = ${equipmentId} and report_date = any(${dates})
    `;
    const ids = staleIds.map((row) => (row as { id: string }).id);
    if (ids.length > 0) {
      // The FK is RESTRICT, so deduction lines go before the reconciliations they cite.
      await sql`
        delete from invoice_line_items
        where reconciliation_id in (
          select id from edtr_reconciliations
          where edtr_id = any(${ids}) or counterpart_edtr_id = any(${ids})
        )`;
      // Accruals also RESTRICT on their reconciliation.
      await sql`
        delete from deposit_accruals
        where reconciliation_id in (
          select id from edtr_reconciliations
          where edtr_id = any(${ids}) or counterpart_edtr_id = any(${ids})
        )`;
      await sql`delete from edtr_reconciliations where edtr_id = any(${ids}) or counterpart_edtr_id = any(${ids})`;
      await sql`delete from edtr_line_items where edtr_id = any(${ids})`;
      await sql`delete from edtr where id = any(${ids})`;
    }

    await sql.end();

    // Dedicated rentals: the shared fixture rental is mutated concurrently. `rentalId` carries a real contract deposit.
    await withTenantTx(adminCtx, async (tx) => {
      const [withDeposit] = await tx
        .insert(rentals)
        .values({
          tenantId: adminCtx.tenantId,
          customerId: (customerRow as { id: string }).id,
          projectSiteId: (siteRow as { id: string }).id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      rentalId = withDeposit!.id;

      const [quotation] = await tx
        .insert(quotations)
        .values({
          tenantId: adminCtx.tenantId,
          customerId: (customerRow as { id: string }).id,
          rentalId,
        })
        .returning();
      await tx.insert(rentalContracts).values({
        tenantId: adminCtx.tenantId,
        quotationId: quotation!.id,
        depositRequired: '100000000.00',
      });

      const [noDeposit] = await tx
        .insert(rentals)
        .values({
          tenantId: adminCtx.tenantId,
          customerId: (customerRow as { id: string }).id,
          projectSiteId: (siteRow as { id: string }).id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      uncappedRentalId = noDeposit!.id;

      // Never paid: no deposit/booking invoice is ever settled for it.
      const [unpaid] = await tx
        .insert(rentals)
        .values({
          tenantId: adminCtx.tenantId,
          customerId: (customerRow as { id: string }).id,
          projectSiteId: (siteRow as { id: string }).id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      unpaidRentalId = unpaid!.id;
    });
    await ensurePaidDeposit(adminCtx, rentalId, uncappedRentalId);
  });

  // Manual transcription: no model output, so tolerance is the only live control.
  async function insertTranscribedPaperCounterpart(
    reportDate: string,
    hoursActive: number,
    hoursIdle: number,
    forRentalId?: string,
    forEquipmentId?: string,
  ): Promise<string> {
    return withTenantTx(adminCtx, async (tx) => {
      const [row] = await tx
        .insert(edtrTable)
        .values({
          tenantId: adminCtx.tenantId,
          rentalId: forRentalId ?? rentalId,
          equipmentId: forEquipmentId ?? equipmentId,
          source: 'paper_ocr',
          reportDate,
          rawFileUri: 'storage://fixtures/money-path.jpg',
          status: 'extracted',
          ocrPayload: {
            model_id: 'manual_transcription',
            api_version: 'n/a',
            analyzed_at: new Date().toISOString(),
            fields: [
              { name: 'hours_active', value: hoursActive, value_type: 'number', confidence: 1 },
              { name: 'hours_idle', value: hoursIdle, value_type: 'number', confidence: 1 },
            ],
            min_field_confidence: 1,
            pages: 1,
          },
        })
        .returning();
      await tx.insert(edtrLineItems).values({
        tenantId: adminCtx.tenantId,
        edtrId: row!.id,
        hoursActive: String(hoursActive),
        hoursIdle: String(hoursIdle),
      });
      return row!.id;
    });
  }

  // Counted by the reconciliation_id FK: exact whatever other suites wrote, and the description is for people.
  const deductionInvoiceCount = async (reconciliationId: string): Promise<number> => {
    const rows = await withTenantTx(adminCtx, (tx) =>
      tx
        .select({ id: invoiceLineItems.id })
        .from(invoiceLineItems)
        .innerJoin(invoicesTable, eq(invoiceLineItems.invoiceId, invoicesTable.id))
        .where(
          and(
            eq(invoicesTable.rentalId, rentalId),
            eq(invoicesTable.invoiceType, 'deposit_deduction'),
            eq(invoiceLineItems.reconciliationId, reconciliationId),
          ),
        ),
    );
    return rows.length;
  };

  const storedAdjustments = async (reconciliationId: string): Promise<Record<string, unknown>> => {
    const [row] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(edtrReconciliations).where(eq(edtrReconciliations.id, reconciliationId)),
    );
    return (row!.adjustments as Record<string, unknown> | null) ?? {};
  };

  // Carries a real model_id: the output the QAD-T39 accuracy gate is about.
  async function insertModelExtractedPaperCounterpart(
    reportDate: string,
    hoursActive: number,
    hoursIdle: number,
  ): Promise<string> {
    return withTenantTx(adminCtx, async (tx) => {
      const [row] = await tx
        .insert(edtrTable)
        .values({
          tenantId: adminCtx.tenantId,
          rentalId,
          equipmentId,
          source: 'paper_ocr',
          reportDate,
          rawFileUri: 'storage://fixtures/money-path-model.jpg',
          status: 'extracted',
          ocrPayload: {
            model_id: 'arkilaunch-edtr-neural-v1',
            api_version: '2024-11-30',
            analyzed_at: new Date().toISOString(),
            fields: [
              { name: 'hours_active', value: hoursActive, value_type: 'number', confidence: 0.99 },
              { name: 'hours_idle', value: hoursIdle, value_type: 'number', confidence: 0.99 },
            ],
            min_field_confidence: 0.99,
            pages: 1,
          },
        })
        .returning();
      await tx.insert(edtrLineItems).values({
        tenantId: adminCtx.tenantId,
        edtrId: row!.id,
        hoursActive: String(hoursActive),
        hoursIdle: String(hoursIdle),
      });
      return row!.id;
    });
  }

  it('QAD-T40: an equal-and-opposite active/idle swap is a discrepancy, not a match', async () => {
    await insertTranscribedPaperCounterpart(DATES.swap, 8, 0);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: DATES.swap,
      lineItems: { hoursActive: 0, hoursIdle: 8 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.status).toBe('review');
    expect(polled.reconciliation?.status).toBe('discrepancy');
    expect(polled.reconciliation?.reason).toBe('tolerance_exceeded');
    // The worst dimension, not the summed total -- the total here is 0.
    expect(polled.reconciliation?.deltaHours).toBe(8);
  });

  it('QAD-T26: approving that discrepancy without adjustments is refused and moves no money', async () => {
    const paperId = await insertTranscribedPaperCounterpart(DATES.refused, 8, 0);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: DATES.refused,
      lineItems: { hoursActive: 0, hoursIdle: 8 },
    });
    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('discrepancy');

    const digitalReconId = polled.reconciliation!.id;
    expect(await deductionInvoiceCount(digitalReconId)).toBe(0);
    await expect(
      edtr.approve(adminCtx, digital.id, { reconciliationId: digitalReconId }),
    ).rejects.toThrow(ConflictException);
    // The assertion that matters: the gate refused AND nothing was written.
    expect(await deductionInvoiceCount(digitalReconId)).toBe(0);

    // The block is a property of the pair; reconcile from the paper side too (the OCR worker's job in production).
    await withTenantTx(adminCtx, (tx) => reconcileEdtr(tx, adminCtx.tenantId, paperId));
    const paperPolled = await edtr.get(adminCtx, paperId);
    expect(paperPolled.reconciliation?.status).toBe('discrepancy');
    const paperReconId = paperPolled.reconciliation!.id;
    await expect(
      edtr.approve(adminCtx, paperId, { reconciliationId: paperReconId }),
    ).rejects.toThrow(ConflictException);
    expect(await deductionInvoiceCount(paperReconId)).toBe(0);
  });

  // delta_hours must be the worst single dimension, never a figure that understates the disagreement.
  it('stores the worst dimension in delta_hours, with the breakdown alongside it', async () => {
    await insertTranscribedPaperCounterpart(DATES.asymmetric, 8, 2);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: DATES.asymmetric,
      lineItems: { hoursActive: 8.4, hoursIdle: 2.3 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('discrepancy');
    expect(polled.reconciliation?.deltaHours).toBeCloseTo(0.7, 5);

    const stored = await storedAdjustments(polled.reconciliation!.id);
    const deltas = stored.deltas as { active: number; idle: number; total: number };
    expect(deltas.active).toBeCloseTo(0.4, 5);
    expect(deltas.idle).toBeCloseTo(0.3, 5);
    expect(deltas.total).toBeCloseTo(0.7, 5);
  });

  // Positive control: "nothing is ever approvable" would otherwise satisfy every test above.
  it('a genuinely matching pair still reconciles and deducts exactly once', async () => {
    await insertTranscribedPaperCounterpart(DATES.match, 6, 1);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: DATES.match,
      lineItems: { hoursActive: 6, hoursIdle: 1 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.status).toBe('reconciled');
    expect(polled.reconciliation?.status).toBe('matched');
    expect(polled.reconciliation?.deltaHours).toBe(0);

    const reconId = polled.reconciliation!.id;
    expect(await deductionInvoiceCount(reconId)).toBe(0);
    const approved = await edtr.approve(adminCtx, digital.id, {
      reconciliationId: reconId,
      adjustments: { hoursActive: 6, hoursIdle: 1 },
    });
    expect(approved.reconciliation.status).toBe('approved');
    expect(await deductionInvoiceCount(reconId)).toBe(1);

    // The human's adjustment must not erase the gate's own finding.
    const stored = await storedAdjustments(polled.reconciliation!.id);
    expect(stored.reason).toBe('auto_accept');
    expect(stored.deltas).toBeDefined();
    expect(stored.hoursActive).toBe(6);
  });

  it('refuses to match a pair where one side has no line items', async () => {
    const emptyPaperId = await withTenantTx(adminCtx, async (tx) => {
      const [row] = await tx
        .insert(edtrTable)
        .values({
          tenantId: adminCtx.tenantId,
          rentalId,
          equipmentId,
          source: 'paper_ocr',
          reportDate: DATES.noEvidence,
          rawFileUri: 'storage://fixtures/no-evidence.jpg',
          status: 'extracted',
          ocrPayload: null,
        })
        .returning();
      return row!.id;
    });

    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: DATES.noEvidence,
      lineItems: { hoursActive: 8, hoursIdle: 0 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.counterpartEdtrId).toBe(emptyPaperId);
    expect(polled.reconciliation?.status).toBe('discrepancy');
    expect(polled.status).toBe('review');
    // Pins the guard itself, not a phantom tolerance_exceeded from all-zero sums.
    expect(polled.reconciliation?.reason).toBe('unreadable');
    expect(polled.reconciliation?.deltaHours).toBeNull();
  });

  // Unset attestation must fail closed.
  it('refuses to deduct from model-extracted evidence with no attested accuracy', async () => {
    // vi.stubEnv, not delete: workers are reused across spec files.
    vi.stubEnv('OCR_MEASURED_ACCURACY', '');
    vi.stubEnv('OCR_MEASURED_SAMPLES', '');
    await insertModelExtractedPaperCounterpart(DATES.modelSourced, 6, 1);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: DATES.modelSourced,
      lineItems: { hoursActive: 6, hoursIdle: 1 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('matched');
    const reconId = polled.reconciliation!.id;

    await expect(
      edtr.approve(adminCtx, digital.id, {
        reconciliationId: reconId,
        adjustments: { hoursActive: 6, hoursIdle: 1 },
      }),
    ).rejects.toThrow(ConflictException);
    expect(await deductionInvoiceCount(reconId)).toBe(0);
  });

  // Past the tenant minimum deposit, the rest becomes an accrual; the deposit never goes below 0.
  it('refuses to deduct from a deposit that was never paid, and writes nothing', async () => {
    await insertTranscribedPaperCounterpart(DATES.unpaid, 6, 1, unpaidRentalId);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId: unpaidRentalId,
      equipmentId,
      reportDate: DATES.unpaid,
      lineItems: { hoursActive: 6, hoursIdle: 1 },
    });
    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('matched');

    await expect(
      edtr.approve(adminCtx, digital.id, {
        reconciliationId: polled.reconciliation!.id,
        adjustments: { hoursActive: 6, hoursIdle: 1 },
      }),
    ).rejects.toMatchObject({ response: { error: 'deposit_not_paid' } });
    const deductions = await withTenantTx(adminCtx, (tx) =>
      tx
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.rentalId, unpaidRentalId), eq(invoicesTable.invoiceType, 'deposit_deduction'))),
    );
    expect(deductions).toHaveLength(0);
  });

  it('caps a deduction on a rental with no configured deposit, accruing the rest', async () => {
    await insertTranscribedPaperCounterpart(
      DATES.uncapped,
      6,
      1,
      uncappedRentalId,
      uncappedEquipmentId,
    );
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId: uncappedRentalId,
      equipmentId: uncappedEquipmentId,
      reportDate: DATES.uncapped,
      lineItems: { hoursActive: 6, hoursIdle: 1 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('matched');
    const reconId = polled.reconciliation!.id;

    const approved = await edtr.approve(adminCtx, digital.id, {
      reconciliationId: reconId,
      adjustments: { hoursActive: 6, hoursIdle: 1 },
    });
    const { minDepositPhp } = await withTenantTx(adminCtx, (tx) => getBillingSettings(tx, adminCtx.tenantId));
    expect(approved.deposit.deducted).toBe(minDepositPhp);
    expect(approved.deposit.balanceAfter).toBe(0);
    expect(approved.deposit.accrued).toBeGreaterThan(0);
    const [accrual] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(depositAccruals).where(eq(depositAccruals.reconciliationId, reconId)),
    );
    expect(Number(accrual!.amount)).toBe(approved.deposit.accrued);
    expect(accrual!.invoiceId).toBeNull();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
