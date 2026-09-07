import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import {
  edtr as edtrTable,
  edtrLineItems,
  edtrReconciliations,
  invoices as invoicesTable,
  invoiceLineItems,
  reconcileEdtr,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';

// QAD-T26 ("deduction without reconciliation": 409, deducts nothing) and
// QAD-T40 ("0% reconciliation discrepancy before deduction"), which the
// money-path-e2e CI job runs this file by name to enforce. RFC-2's central
// invariant is that no deposit deduction happens without a passing
// reconciliation or an explicit human approval, so the assertions here are
// deliberately about money NOT moving: a deduction-invoice count that
// stayed put, not merely a thrown exception.
//
// The pairing used throughout is a manually transcribed paper sheet plus a
// digital entry. That is not an arbitrary choice: with ENABLE_OCR_PIPELINE
// off (the default, and the pilot's real posture) manual transcription is
// the ONLY way a deduction can be approved at all, so it is the path that
// actually needs guarding.
describe('the money path: no deduction without a passing reconciliation', () => {
  const edtr = new EdtrService(new EventsService());
  let adminCtx: RequestContext;
  let rentalId: string;
  let equipmentId: string;

  // Own date range, disjoint from every other suite's. Vitest runs spec
  // files in parallel and they all draw the same seeded rental and
  // equipment, so two suites sharing an equipment-day will pair against
  // each other's rows -- and the beforeAll cleanup below will delete them.
  // Taken as of this commit: 2020-02-0X (billing), 2021-03-01..10
  // (edtr-engine), 2021-04-01..02 (ai-abuse), 2021-05-01..03 (fleet).
  // 2021-06 is free; check this list before adding a date here.
  const DATES = {
    swap: '2021-06-01',
    asymmetric: '2021-06-02',
    refused: '2021-06-03',
    match: '2021-06-04',
    noEvidence: '2021-06-05',
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
    const [rental] = await sql`select id from rentals where tenant_id = ${tenantId} limit 1`;
    const [equipment] = await sql`select id from equipment where tenant_id = ${tenantId} limit 1`;

    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    rentalId = (rental as { id: string }).id;
    equipmentId = (equipment as { id: string }).id;

    // Fixed report dates, so a prior run's rows for the same equipment-day
    // would make the counterpart lookup pair against stale data. Same
    // idempotency guard as edtr-engine.spec.ts.
    const dates = Object.values(DATES);
    const staleIds = await sql`
      select id from edtr where equipment_id = ${equipmentId} and report_date = any(${dates})
    `;
    const ids = staleIds.map((row) => (row as { id: string }).id);
    if (ids.length > 0) {
      await sql`delete from edtr_reconciliations where edtr_id = any(${ids}) or counterpart_edtr_id = any(${ids})`;
      await sql`delete from edtr_line_items where edtr_id = any(${ids})`;
      await sql`delete from edtr where id = any(${ids})`;
    }
    await sql.end();
  });

  // An already-extracted paper counterpart carrying a manual-transcription
  // payload: min_field_confidence 1, because a human read the sheet and
  // there is no model output for the 0.90 gate to gate. That leaves the
  // tolerance check as the only live control, which is what these tests
  // probe.
  async function insertTranscribedPaperCounterpart(
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

  // Counted by reconciliation id, not by rental. The seeded fixtures give
  // every suite in this package the same first rental, and vitest runs spec
  // files in parallel by default, so a rental-wide count would race
  // edtr-engine.spec.ts's own approvals and fail intermittently. The
  // description written at edtr.service.ts:446 embeds the reconciliation
  // id, which makes the count exact and immune to anything else running.
  const deductionInvoiceCount = async (reconciliationId: string): Promise<number> => {
    const rows = await withTenantTx(adminCtx, (tx) =>
      tx
        .select({ description: invoiceLineItems.description })
        .from(invoiceLineItems)
        .innerJoin(invoicesTable, eq(invoiceLineItems.invoiceId, invoicesTable.id))
        .where(
          and(
            eq(invoicesTable.rentalId, rentalId),
            eq(invoicesTable.invoiceType, 'deposit_deduction'),
          ),
        ),
    );
    return rows.filter((row) => row.description.includes(reconciliationId)).length;
  };

  const storedAdjustments = async (reconciliationId: string): Promise<Record<string, unknown>> => {
    const [row] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(edtrReconciliations).where(eq(edtrReconciliations.id, reconciliationId)),
    );
    return (row!.adjustments as Record<string, unknown> | null) ?? {};
  };

  // THE regression test. Both logs agree the unit ran 8 hours; they
  // disagree completely about whether those hours were billable. The old
  // summed-scalar comparison saw |8 - 8| = 0 and auto-accepted, then priced
  // the approving side's active hours against the deposit. Two independent
  // logs exist precisely to catch this, so it must not match.
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

    // Neither side is approvable -- the block is a property of the pair,
    // not of whichever row the admin happened to open. reconcileEdtr()
    // writes one reconciliation row per EDTR id, and the row keyed on the
    // paper side only exists once reconcile has run from that side too (in
    // production, the OCR worker does this); without it get() returns a
    // null reconciliation and there is nothing to attempt an approve with.
    await withTenantTx(adminCtx, (tx) => reconcileEdtr(tx, adminCtx.tenantId, paperId));
    const paperPolled = await edtr.get(adminCtx, paperId);
    expect(paperPolled.reconciliation?.status).toBe('discrepancy');
    const paperReconId = paperPolled.reconciliation!.id;
    await expect(
      edtr.approve(adminCtx, paperId, { reconciliationId: paperReconId }),
    ).rejects.toThrow(ConflictException);
    expect(await deductionInvoiceCount(paperReconId)).toBe(0);
  });

  // Pins delta_hours' meaning. Active diverges by 0.4 and idle by 0.3, so
  // the summed total diverges by 0.7. The stored scalar must be the worst
  // single dimension, never a figure that understates the disagreement.
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

  // The positive control: the gate must still let a genuine match through,
  // or "nothing is ever approvable" would satisfy every test above while
  // making the product useless.
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

    // The human's adjustment must not erase the machine's own finding:
    // reconstructing "what the gate concluded vs what the human approved"
    // is the audit trail behind every deduction.
    const stored = await storedAdjustments(polled.reconciliation!.id);
    expect(stored.reason).toBe('auto_accept');
    expect(stored.deltas).toBeDefined();
    expect(stored.hoursActive).toBe(6);
  });

  // A pair where one side carries no line items at all summed to zero in
  // every dimension, so it read as perfect agreement and auto-accepted on
  // no evidence whatsoever.
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
    // Pin the guard specifically. Without asserting the reason, this test
    // would still pass if the guard were deleted and the empty side merely
    // produced a tolerance_exceeded from its phantom all-zero sums -- the
    // weaker of the two behaviours, and one that reports a hours
    // disagreement where the truth is that a log has no hours at all.
    expect(polled.reconciliation?.reason).toBe('unreadable');
    expect(polled.reconciliation?.deltaHours).toBeNull();
  });
});
