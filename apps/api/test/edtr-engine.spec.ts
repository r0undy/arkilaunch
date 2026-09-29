import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import postgres from 'postgres';
import {
  addresses,
  edtr as edtrTable,
  edtrReconciliations,
  equipmentAssignments,
  invoices,
  edtrLineItems,
  projectSites,
  quotations,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';
import { ensurePaidDeposit } from './paid-deposit.js';

// QAD-T1 (happy), QAD-T11/QAD-T26 (no deduction without the gate), QAD-T29 (timekeeper site scope).
describe('EdtrService: capture, poll, and the approve/deduct gate', () => {
  const edtr = new EdtrService(new EventsService());
  let adminCtx: RequestContext;
  let timekeeperCtx: RequestContext;
  let rentalId: string;
  let equipmentId: string;
  let unassignedRentalId: string;

  beforeAll(async () => {
    // Fixtures are model-extracted, so attest a passing accuracy; money-path covers the unattested case.
    process.env.OCR_MEASURED_ACCURACY = '0.95';
    process.env.OCR_MEASURED_SAMPLES = '250';
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [timekeeper] = await sql`select id from users where tenant_id = ${tenantId} and email = 'timekeeper@test-tenant-a.test'`;
    const [rental] = await sql`select id from rentals where tenant_id = ${tenantId} limit 1`;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;

    // A dedicated unit: runtime_hours is asserted as a delta, and a shared row accrues other specs' approvals.
    const [rateCardRow] =
      // A type-wide card in force across this spec's 2021-03 dates.
      await sql`select equipment_type_id from rate_cards where tenant_id = ${tenantId} and rate_type = 'hourly' and equipment_id is null and effective_from <= '2021-03-01' and (effective_to is null or effective_to > '2021-03-07') order by effective_from limit 1`;
    const equipmentTypeId = (rateCardRow as { equipment_type_id: string }).equipment_type_id;
    const [equipment] = await sql`
      insert into equipment (tenant_id, equipment_type_id, model, serial_no)
      values (${tenantId}, ${equipmentTypeId}, 'EDTR Engine Test Unit', ${`test-tenant-a-serial-edtr-${Date.now()}`})
      returning id
    `;

    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    timekeeperCtx = { tenantId, userId: (timekeeper as { id: string }).id, role: 'timekeeper' };
    rentalId = (rental as { id: string }).id;
    equipmentId = (equipment as { id: string }).id;

    // Fixed dates, so a prior run's rows would pair as stale counterparts.
    const testDates = ['2021-03-01', '2021-03-02', '2021-03-03', '2021-03-04', '2021-03-05', '2021-03-06'];
    const staleIds = await sql`
      select id from edtr where equipment_id = ${equipmentId} and report_date = any(${testDates})
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
      await sql`delete from edtr_reconciliations where edtr_id = any(${ids}) or counterpart_edtr_id = any(${ids})`;
      await sql`delete from edtr_line_items where edtr_id = any(${ids})`;
      await sql`delete from edtr where id = any(${ids})`;
    }

    const [customerRow] = await sql`select id from customers where tenant_id = ${tenantId} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    const [siteRow] = await sql`select id from project_sites where tenant_id = ${tenantId} limit 1`;

    await sql.end();

    // A dedicated rental with a real contract deposit: the shared fixture rental is mutated concurrently.
    await withTenantTx(adminCtx, async (tx) => {
      const [rentalRow] = await tx
        .insert(rentals)
        .values({
          tenantId,
          customerId: (customerRow as { id: string }).id,
          projectSiteId: (siteRow as { id: string }).id,
          status: 'active',
          startDate: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      rentalId = rentalRow!.id;

      const [quotation] = await tx
        .insert(quotations)
        .values({ tenantId, customerId: (customerRow as { id: string }).id, rentalId })
        .returning();
      await tx.insert(rentalContracts).values({
        tenantId,
        quotationId: quotation!.id,
        depositRequired: '100000000.00',
      });
    });

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
    await ensurePaidDeposit(adminCtx, rentalId, unassignedRentalId);
  });

  // Simulates an already-extracted paper counterpart; the real worker is covered in the jobs package.
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

  // The second side of an approved pair must 409, so one day's work yields one deduction and one accrual.
  it('PRD-F4 / QAD-T26: approving the second side of an already-approved pair is rejected', async () => {
    const { reconcileEdtr, equipment: equipmentTable, eq: eqFn } = await import('@arkilaunch/db').then(async (db) => ({
      ...db,
      eq: (await import('drizzle-orm')).eq,
    }));
    const reportDate = '2021-03-06';
    const paperId = await insertExtractedPaperCounterpart(reportDate, 6, 0);

    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 6, hoursIdle: 0 },
    });
    const digitalPolled = await edtr.get(adminCtx, digital.id);
    expect(digitalPolled.reconciliation?.status).toBe('matched');

    // The second reconciliation row, keyed on the paper side.
    await withTenantTx(adminCtx, (tx) => reconcileEdtr(tx, adminCtx.tenantId, paperId));
    const paperPolled = await edtr.get(adminCtx, paperId);
    expect(paperPolled.reconciliation?.status).toBe('matched');

    const runtimeOf = async () => {
      const [row] = await withTenantTx(adminCtx, (tx) =>
        tx.select().from(equipmentTable).where(eqFn(equipmentTable.id, equipmentId)).limit(1),
      );
      return Number(row!.runtimeHours);
    };

    const invoiceCountFor = async () => {
      const { invoices: invoicesTable } = await import('@arkilaunch/db');
      const { and } = await import('drizzle-orm');
      const rows = await withTenantTx(adminCtx, (tx) =>
        tx
          .select()
          .from(invoicesTable)
          .where(and(eqFn(invoicesTable.rentalId, rentalId), eqFn(invoicesTable.invoiceType, 'deposit_deduction'))),
      );
      return rows.length;
    };

    const runtimeBefore = await runtimeOf();
    const invoicesBefore = await invoiceCountFor();
    await edtr.approve(adminCtx, digital.id, { reconciliationId: digitalPolled.reconciliation!.id });
    const runtimeAfterFirst = await runtimeOf();
    const invoicesAfterFirst = await invoiceCountFor();
    expect(runtimeAfterFirst).toBeCloseTo(runtimeBefore + 6, 5);
    expect(invoicesAfterFirst).toBe(invoicesBefore + 1);

    // Approving the counterpart of an already-approved pair must be
    // rejected: no second invoice, no second accrual.
    await expect(
      edtr.approve(adminCtx, paperId, { reconciliationId: paperPolled.reconciliation!.id }),
    ).rejects.toThrow(ConflictException);
    const runtimeAfterSecond = await runtimeOf();
    const invoicesAfterSecond = await invoiceCountFor();
    expect(runtimeAfterSecond).toBeCloseTo(runtimeAfterFirst, 5);
    expect(invoicesAfterSecond).toBe(invoicesAfterFirst);
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
    const denials = async () => {
      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      const [row] = await sql`select count(*)::int as n from audit_logs where entity = 'edtr_site_scope_denied' and entity_id = ${unassignedRentalId}`;
      await sql.end();
      return (row as { n: number }).n;
    };
    const before = await denials();
    await expect(
      edtr.capture(timekeeperCtx, {
        source: 'digital_entry',
        rentalId: unassignedRentalId,
        equipmentId,
        reportDate: '2021-03-04',
        lineItems: { hoursActive: 8, hoursIdle: 0 },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(await denials()).toBe(before + 1);
  });

  it('capture refuses a unit that is not on the rental, and a unit this tenant cannot see', async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const [other] = await sql`
      insert into equipment (tenant_id, equipment_type_id, model, serial_no)
      select tenant_id, equipment_type_id, 'EDTR Off-Rental Unit', ${`test-tenant-a-serial-edtr-off-${Date.now()}`}
      from equipment where id = ${equipmentId}
      returning id`;
    const [foreign] = await sql`
      select e.id from equipment e join tenants t on t.id = e.tenant_id where t.slug = 'test-tenant-b' limit 1`;
    await sql.end();

    const assignedRentalId = await withTenantTx(adminCtx, async (tx) => {
      const [base] = await tx.select().from(rentals).where(eq(rentals.id, rentalId));
      const [row] = await tx
        .insert(rentals)
        .values({ tenantId: adminCtx.tenantId, customerId: base!.customerId, projectSiteId: base!.projectSiteId, status: 'active', startDate: base!.startDate })
        .returning();
      await tx.insert(equipmentAssignments).values({
        tenantId: adminCtx.tenantId,
        equipmentId,
        rentalId: row!.id,
        start: new Date('2020-01-01T00:00:00Z'),
        status: 'active',
      });
      return row!.id;
    });
    const entry = { source: 'digital_entry' as const, reportDate: '2021-03-13', lineItems: { hoursActive: 8, hoursIdle: 0 } };

    await expect(
      edtr.capture(adminCtx, { ...entry, rentalId: assignedRentalId, equipmentId: (other as { id: string }).id }),
    ).rejects.toMatchObject({ response: { error: 'equipment_not_on_rental' } });
    await expect(
      edtr.capture(adminCtx, { ...entry, rentalId, equipmentId: (foreign as { id: string }).id }),
    ).rejects.toThrow(NotFoundException);
    const written = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(edtrTable).where(and(eq(edtrTable.reportDate, '2021-03-13'), inArray(edtrTable.rentalId, [rentalId, assignedRentalId]))),
    );
    expect(written).toHaveLength(0);
  });

  it('approve refuses a report date outside the rental, and bills nothing', async () => {
    const reportDate = '2019-12-01';
    const paperId = await insertExtractedPaperCounterpart(reportDate, 8, 0);
    const { reconcileEdtr } = await import('@arkilaunch/db');
    await withTenantTx(adminCtx, (tx) => reconcileEdtr(tx, adminCtx.tenantId, paperId));
    const deductions = () =>
      withTenantTx(adminCtx, (tx) =>
        tx.select().from(invoices).where(and(eq(invoices.rentalId, rentalId), eq(invoices.invoiceType, 'deposit_deduction'))),
      ).then((rows) => rows.length);
    const before = await deductions();

    await expect(
      edtr.review(adminCtx, paperId, { decision: 'approve', hours: { hoursActive: 8, hoursIdle: 0 } }),
    ).rejects.toMatchObject({ response: { error: 'report_date_outside_rental' } });
    expect(await deductions()).toBe(before);
  });

  it('an approve that waits on a concurrent reject sees the rejection and deducts nothing', async () => {
    const reportDate = '2021-03-14';
    await insertExtractedPaperCounterpart(reportDate, 7, 0);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 7, hoursIdle: 0 },
    });
    const reconId = (await edtr.get(adminCtx, digital.id)).reconciliation!.id;

    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    let outcome: unknown;
    await sql.begin(async (t) => {
      await t`select id from edtr_reconciliations where id = ${reconId} for update`;
      const pending = edtr.approve(adminCtx, digital.id, { reconciliationId: reconId }).then(
        () => 'approved',
        (err: unknown) => err,
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await t`update edtr_reconciliations set status = 'rejected' where id = ${reconId}`;
      outcome = pending;
    });
    await sql.end();

    expect(await outcome).toBeInstanceOf(UnprocessableEntityException);
    const [recon] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(edtrReconciliations).where(eq(edtrReconciliations.id, reconId)),
    );
    expect(recon?.status).toBe('rejected');
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

  // cr-arkilaunch-f9-read-surface.md: S8 review queue.
  it('GET /edtr (list) filters by rentalId and sorts review-status rows first', async () => {
    const { items, total } = await edtr.list(adminCtx, { rentalId, limit: 100, offset: 0 });
    expect(total).toBeGreaterThan(0);
    expect(items.every((item) => item.rentalId === rentalId)).toBe(true);

    const reviewIndexes = items.flatMap((item, i) => (item.status === 'review' ? [i] : []));
    const nonReviewIndexes = items.flatMap((item, i) => (item.status !== 'review' ? [i] : []));
    if (reviewIndexes.length > 0 && nonReviewIndexes.length > 0) {
      expect(Math.max(...reviewIndexes)).toBeLessThan(Math.min(...nonReviewIndexes));
    }
  });

  // QAD-T29 extended to reads: a timekeeper's queue excludes EDTRs on sites
  // they are not assigned to, even ones that already exist.
  it('QAD-T29 (read): a timekeeper only sees EDTRs tied to sites they are assigned to', async () => {
    await withTenantTx(adminCtx, (tx) =>
      tx.insert(edtrTable).values({
        tenantId: adminCtx.tenantId,
        rentalId: unassignedRentalId,
        equipmentId,
        source: 'digital_entry',
        reportDate: '2021-03-07',
        status: 'review',
      }),
    );

    const { items } = await edtr.list(timekeeperCtx, { limit: 200, offset: 0 });
    expect(items.every((item) => item.rentalId !== unassignedRentalId)).toBe(true);
    expect(items.some((item) => item.rentalId === rentalId)).toBe(true);

    const adminView = await edtr.list(adminCtx, { rentalId: unassignedRentalId, limit: 10, offset: 0 });
    expect(adminView.total).toBeGreaterThan(0);
  });

  // PRD §5.3 "Review -> Rejected -> Capture" (cr-arkilaunch-f9-read-surface.md).
  it('POST /edtr/:id/reject rejects a pending reconciliation, deducts nothing, and blocks any later approve', async () => {
    const { invoices: invoicesTable, eq: eqFn } = await import('@arkilaunch/db').then(async (db) => ({
      ...db,
      eq: (await import('drizzle-orm')).eq,
    }));
    const reportDate = '2021-03-08';
    const first = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 3, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtx, first.id);
    expect(polled.reconciliation?.status).toBe('pending');

    const countInvoices = () =>
      withTenantTx(adminCtx, (tx) => tx.select().from(invoicesTable).where(eqFn(invoicesTable.rentalId, rentalId))).then(
        (rows) => rows.length,
      );
    const before = await countInvoices();

    const rejected = await edtr.reject(adminCtx, first.id, { reason: 'duplicate entry' });
    expect(rejected.status).toBe('rejected');
    expect(await countInvoices()).toBe(before);

    await expect(
      edtr.approve(adminCtx, first.id, { reconciliationId: polled.reconciliation!.id }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('POST /edtr/:id/reject cannot reject an already-approved reconciliation', async () => {
    const reportDate = '2021-03-09';
    await insertExtractedPaperCounterpart(reportDate, 5, 0);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 5, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtx, digital.id);
    await edtr.approve(adminCtx, digital.id, { reconciliationId: polled.reconciliation!.id });

    await expect(edtr.reject(adminCtx, digital.id, {})).rejects.toThrow(ConflictException);
  });

  it('POST /edtr/:id/reject cannot be called twice on the same reconciliation', async () => {
    const reportDate = '2021-03-10';
    const first = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 3, hoursIdle: 0 },
    });
    await edtr.reject(adminCtx, first.id, {});
    await expect(edtr.reject(adminCtx, first.id, {})).rejects.toThrow(ConflictException);
  });

  it('a log captured after a pair is approved does not re-pair with the approved rows', async () => {
    const reportDate = '2021-03-11';
    const paperId = await insertExtractedPaperCounterpart(reportDate, 4, 0);
    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 4, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtx, digital.id);
    await edtr.approve(adminCtx, digital.id, { reconciliationId: polled.reconciliation!.id });
    const paperBefore = await edtr.get(adminCtx, paperId);

    const late = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 4, hoursIdle: 0 },
    });
    const latePolled = await edtr.get(adminCtx, late.id);
    expect(latePolled.reconciliation?.status).toBe('pending');
    expect(latePolled.reconciliation?.counterpartEdtrId ?? null).toBeNull();
    expect((await edtr.get(adminCtx, paperId)).status).toBe(paperBefore.status);
  });

  it('a log captured after its counterpart was rejected does not pair with the rejected row', async () => {
    const reportDate = '2021-03-12';
    const paperId = await insertExtractedPaperCounterpart(reportDate, 3, 0);
    const { reconcileEdtr } = await import('@arkilaunch/db');
    await withTenantTx(adminCtx, (tx) => reconcileEdtr(tx, adminCtx.tenantId, paperId));
    await edtr.reject(adminCtx, paperId, { reason: 'illegible' });

    const digital = await edtr.capture(adminCtx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: { hoursActive: 3, hoursIdle: 0 },
    });
    const polled = await edtr.get(adminCtx, digital.id);
    expect(polled.reconciliation?.status).toBe('pending');
    expect(polled.reconciliation?.counterpartEdtrId ?? null).toBeNull();
  });
});
