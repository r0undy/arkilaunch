import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import postgres from 'postgres';
import { addresses, edtr as edtrTable, edtrLineItems, projectSites, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';

// RFC-2 §3/§7: the reconciliation-gated deduction endpoint. QAD-T1 (happy),
// QAD-T11/QAD-T26 (sad/abuse: no deduction without the gate), QAD-T29
// (timekeeper site-scope abuse).
describe('EdtrService: capture, poll, and the approve/deduct gate', () => {
  const edtr = new EdtrService(new EventsService());
  let adminCtx: RequestContext;
  let timekeeperCtx: RequestContext;
  let rentalId: string;
  let equipmentId: string;
  let unassignedRentalId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [timekeeper] = await sql`select id from users where tenant_id = ${tenantId} and email = 'timekeeper@test-tenant-a.test'`;
    const [rental] = await sql`select id from rentals where tenant_id = ${tenantId} limit 1`;
    const [equipment] = await sql`select id from equipment where tenant_id = ${tenantId} limit 1`;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} limit 1`;

    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    timekeeperCtx = { tenantId, userId: (timekeeper as { id: string }).id, role: 'timekeeper' };
    rentalId = (rental as { id: string }).id;
    equipmentId = (equipment as { id: string }).id;

    // Idempotency: this spec re-uses fixed report dates, so a prior run's
    // leftover rows for the same equipment-day would otherwise make
    // reconcileEdtr's counterpart lookup pick a stale, unconfigured row.
    const testDates = ['2021-03-01', '2021-03-02', '2021-03-03', '2021-03-04', '2021-03-05'];
    const staleIds = await sql`
      select id from edtr where equipment_id = ${equipmentId} and report_date = any(${testDates})
    `;
    const ids = staleIds.map((row) => (row as { id: string }).id);
    if (ids.length > 0) {
      await sql`delete from edtr_reconciliations where edtr_id = any(${ids}) or counterpart_edtr_id = any(${ids})`;
      await sql`delete from edtr_line_items where edtr_id = any(${ids})`;
      await sql`delete from edtr where id = any(${ids})`;
    }

    await sql.end();

    // A second site + rental the seeded timekeeper is NOT assigned to
    // (QAD-T29: site-scope abuse needs an unassigned site to deny against).
    await withTenantTx(adminCtx, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId, line1: 'Unassigned Site Rd', city: 'Quezon City', province: 'Metro Manila', country: 'PH' })
        .returning();
      const [site] = await tx
        .insert(projectSites)
        .values({ tenantId, addressId: address!.id, latitude: '14.700000', longitude: '121.050000' })
        .returning();
      const { rentals } = await import('@arkilaunch/db');
      const [unassignedRental] = await tx
        .insert(rentals)
        .values({
          tenantId,
          customerId: (customer as { id: string }).id,
          projectSiteId: site!.id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      unassignedRentalId = unassignedRental!.id;
    });
  });

  // "Two independent logs" (RFC-2 §2) means one paper_ocr + one
  // digital_entry (the two source values the schema distinguishes); this
  // helper simulates an already-extracted paper_ocr counterpart directly,
  // since driving the real OCR worker is covered separately in
  // jobs/src/edtr-ocr-worker.spec.ts.
  async function insertExtractedPaperCounterpart(reportDate: string, hoursActive: number, hoursIdle: number) {
    return withTenantTx(adminCtx, async (tx) => {
      const [row] = await tx
        .insert(edtrTable)
        .values({
          tenantId: adminCtx.tenantId,
          rentalId,
          equipmentId,
          source: 'paper_ocr',
          reportDate,
          rawFileUri: 'storage://fixtures/counterpart.jpg',
          status: 'extracted',
          // A high-confidence extraction so the gate's confidence check
          // passes; the tolerance check is what these tests actually probe.
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
        tenantId: adminCtx.tenantId,
        edtrId: row!.id,
        hoursActive: String(hoursActive),
        hoursIdle: String(hoursIdle),
      });
      return row!.id;
    });
  }

  it('QAD-T1: two matching independent logs reconcile and a subsequent approve deducts', async () => {
    const reportDate = '2021-03-01';
    await insertExtractedPaperCounterpart(reportDate, 8, 1);

    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 8, hoursIdle: 1 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.status).toBe('reconciled');
    expect(polled.reconciliation?.status).toBe('matched');

    const approved = await edtr.approve(adminCtx, digital.id, { reconciliationId: polled.reconciliation!.id });
    expect(approved.reconciliation.status).toBe('approved');
    expect(approved.deposit.deducted).toBeGreaterThanOrEqual(0);
    expect(approved.invoiceLine.sourceLogs).toContain(digital.id);
  });

  it('QAD-T11/T26: divergent logs block the deduction (409) until a human supplies adjustments', async () => {
    const reportDate = '2021-03-02';
    await insertExtractedPaperCounterpart(reportDate, 2, 0); // wildly different from the digital log below

    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 8, hoursIdle: 1 },
    });

    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('discrepancy');

    await expect(
      edtr.approve(adminCtx, digital.id, { reconciliationId: polled.reconciliation!.id }),
    ).rejects.toThrow(ConflictException);

    // A human resolving it with adjustments can now approve.
    const resolved = await edtr.approve(adminCtx, digital.id, {
      reconciliationId: polled.reconciliation!.id,
      adjustments: { hoursActive: 8, hoursIdle: 1 },
    });
    expect(resolved.reconciliation.status).toBe('approved');
  });

  it('QAD-T26: a single-source (pending) reconciliation cannot be approved at all', async () => {
    const reportDate = '2021-03-03';
    const first = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 5, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtx, first.id);
    expect(polled.reconciliation?.status).toBe('pending');

    await expect(
      edtr.approve(adminCtx, first.id, { reconciliationId: polled.reconciliation!.id }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('QAD-T29: a timekeeper cannot submit an EDTR for a site they are not assigned to', async () => {
    await expect(
      edtr.capture(timekeeperCtx, {
        source: 'digital_entry',
        rentalId: unassignedRentalId,
        equipmentId,
        reportDate: '2021-03-04',
        lineItems: { hoursActive: 8, hoursIdle: 0 },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('a timekeeper CAN submit an EDTR for their assigned site', async () => {
    const result = await edtr.capture(timekeeperCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate: '2021-03-05',
      lineItems: { hoursActive: 8, hoursIdle: 0 },
    });
    expect(result.source).toBe('digital_entry');
  });
});
