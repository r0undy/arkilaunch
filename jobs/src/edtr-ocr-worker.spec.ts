import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { and, eq, inArray } from 'drizzle-orm';
import { edtr, edtrLineItems, edtrReconciliations } from '@arkilaunch/db';
import { FixtureDocumentIntelligenceAdapter } from '@arkilaunch/shared/testing';
import type { DocumentExtractionResult } from '@arkilaunch/shared';
import { runEdtrOcrWorker } from './edtr-ocr-worker.js';
import { makeJobDb } from './db-client.js';

// RFC-2 §2/§3 (RFC2-02/RFC2-03): the worker's claim/extract/fan-out/
// reconcile loop, run against the stub-equivalent
// FixtureDocumentIntelligenceAdapter so it is fully exercisable offline (no
// live Azure DI resource).
//
// Fixtures are TABLES, not document-level fields: the real Almara EDTR is a
// multi-day timesheet grid and the worker reads prebuilt-layout's table
// output (docs/cr-arkilaunch-edtr-real-form.md). The header shape below is
// the one the live resource actually returned for that form.
describe('edtr-ocr-worker', () => {
  let tenantId: string;
  let rentalId: string;
  let equipmentId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [rental] = await sql`select id from rentals where tenant_id = ${tenantId} limit 1`;
    rentalId = (rental as { id: string }).id;
    const [equipment] = await sql`select id from equipment where tenant_id = ${tenantId} limit 1`;
    equipmentId = (equipment as { id: string }).id;
    await sql.end();
  });

  // The worker gates on ENABLE_OCR_PIPELINE before anything else (see
  // edtr-ocr-worker.ts); these tests exercise the loop itself, so they
  // always run with the flag on.
  beforeEach(() => {
    process.env.ENABLE_OCR_PIPELINE = 'true';
  });

  const stubFetchBytes = async () => Buffer.from('fixture-bytes');

  // Every date in this file sits in 2022, a year no other spec uses. The
  // worker pairs on (equipment_id, report_date) against the shared seeded
  // tenant, so a date another suite -- or an older run of this one -- also
  // touches makes a test reconcile against a row it never created.

  const HEADER = [
    ['DATE', 'AM', '', 'PM', '', 'OVERTIME', '', 'TOTAL HOURS', 'SIGNATURE'],
    ['', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', ''],
  ];

  function sheet(dataRows: string[][], confidence = 0.97): DocumentExtractionResult {
    const rows = [...HEADER, ...dataRows];
    return {
      fields: {},
      tables: [
        {
          rowCount: rows.length,
          columnCount: 9,
          cells: rows.flatMap((row, rowIndex) =>
            row.map((content, columnIndex) => ({
              rowIndex,
              columnIndex,
              content,
              // Header cells stay crisp; only the data rows carry the
              // confidence under test.
              confidence: rowIndex < HEADER.length ? 0.99 : confidence,
            })),
          ),
        },
      ],
    };
  }

  // Dates are written in full ISO form so no test depends on the
  // capture-date year resolution, which has its own unit tests in
  // packages/shared/src/edtr-sheet.spec.ts. 07:00-11:30 plus 13:00-17:00 is
  // 8.5 hours, so a total of '8.5' is self-consistent.
  function day(date: string, total: string): string[] {
    return [date, '07:00', '11:30', '13:00', '17:00', '', '', total, ''];
  }

  async function insertQueuedPaperEdtr(reportDate: string) {
    const { db, client } = makeJobDb();
    const [row] = await db
      .insert(edtr)
      .values({
        tenantId,
        rentalId,
        equipmentId,
        source: 'paper_ocr',
        reportDate,
        rawFileUri: 'storage://fixtures/edtr-sample.jpg',
        status: 'queued',
      })
      .returning();
    await client.end();
    return row!;
  }

  async function cleanup(ids: string[]) {
    const { db, client } = makeJobDb();
    await db.delete(edtrReconciliations).where(inArray(edtrReconciliations.edtrId, ids));
    await db.delete(edtrLineItems).where(inArray(edtrLineItems.edtrId, ids));
    await db.delete(edtr).where(inArray(edtr.id, ids));
    await client.end();
  }

  it('extracts a single-day sheet, and with no counterpart yet routes to review (single_source)', async () => {
    const row = await insertQueuedPaperEdtr('2022-02-01');

    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day('2022-02-01', '8.5')])),
      stubFetchBytes,
    );

    const { db, client } = makeJobDb();
    const [updated] = await db.select().from(edtr).where(eq(edtr.id, row.id));
    const [item] = await db.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, row.id));
    await client.end();

    expect(updated!.status).toBe('review'); // single independent log so far
    expect(Number(item!.hoursActive)).toBe(8.5);
    // The form has no idle column, so this is unrecorded, NOT zero.
    expect(item!.hoursIdle).toBeNull();
  });

  it('fans one multi-day sheet out into one edtr row per dated line', async () => {
    // The load-bearing case for the real form: a single photograph carries a
    // week of equipment-days, and each has to reconcile against its own
    // counterpart separately. Keeping them in one row would let a +2h error
    // on Monday cancel a -2h error on Tuesday inside a summed total.
    const row = await insertQueuedPaperEdtr('2022-04-01');
    const dates = ['2022-04-01', '2022-04-02', '2022-04-03'];

    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet(dates.map((d) => day(d, '8.5')))),
      stubFetchBytes,
    );

    const { db, client } = makeJobDb();
    const created = await db
      .select()
      .from(edtr)
      .where(and(eq(edtr.equipmentId, equipmentId), inArray(edtr.reportDate, dates)));
    await client.end();

    expect(created).toHaveLength(3);
    expect(created.map((c) => c.reportDate).sort()).toEqual(dates);
    // Every sibling carries the same source document.
    expect(new Set(created.map((c) => c.rawFileUri))).toEqual(
      new Set(['storage://fixtures/edtr-sample.jpg']),
    );
    // The claimed row hosts day one rather than being left behind.
    expect(created.some((c) => c.id === row.id && c.reportDate === '2022-04-01')).toBe(true);

    await cleanup(created.map((c) => c.id));
  });

  it('routes a day to review when the sheet contradicts itself, even with a matching counterpart', async () => {
    // 07:00-11:30 plus 13:00-17:00 is 8.5 hours, but the operator wrote 10.5.
    // A digital counterpart agreeing with the WRITTEN total must not rescue
    // it: two readings of this page already disagree.
    const reportDate = '2022-05-01';
    const row = await insertQueuedPaperEdtr(reportDate);

    const { db, client } = makeJobDb();
    const [digitalRow] = await db
      .insert(edtr)
      .values({ tenantId, rentalId, equipmentId, source: 'digital_entry', reportDate, status: 'extracted' })
      .returning();
    await db
      .insert(edtrLineItems)
      .values({ tenantId, edtrId: digitalRow!.id, hoursActive: '10.5', hoursIdle: '0.0' });
    await client.end();

    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day(reportDate, '10.5')])),
      stubFetchBytes,
    );

    const { db: db2, client: c2 } = makeJobDb();
    const [updated] = await db2.select().from(edtr).where(eq(edtr.id, row.id));
    await c2.end();

    expect(updated!.status).toBe('review');
    expect(updated!.lastError).toBe('total_mismatch:written=10.5,computed=8.5');

    await cleanup([row.id, digitalRow!.id]);
  });

  it('auto-accepts against a digital counterpart even though the paper log has no idle hours', async () => {
    // The paper form records no idle time at all, so the idle dimension is
    // not comparable and the gate decides on active hours -- the figure the
    // deduction is priced on. Before migration 0017 this pair could only
    // match by fabricating a 0 for the paper side.
    const reportDate = '2022-02-03';
    const paperRow = await insertQueuedPaperEdtr(reportDate);

    const { db, client } = makeJobDb();
    const [digitalRow] = await db
      .insert(edtr)
      .values({ tenantId, rentalId, equipmentId, source: 'digital_entry', reportDate, status: 'extracted' })
      .returning();
    await db
      .insert(edtrLineItems)
      .values({ tenantId, edtrId: digitalRow!.id, hoursActive: '8.5', hoursIdle: '1.0' });
    await client.end();

    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day(reportDate, '8.5')])),
      stubFetchBytes,
    );

    const { db: db2, client: client2 } = makeJobDb();
    const [updatedPaper] = await db2.select().from(edtr).where(eq(edtr.id, paperRow.id));
    const [reconciliation] = await db2
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.edtrId, paperRow.id));
    await client2.end();

    expect(updatedPaper!.status).toBe('reconciled');
    expect(reconciliation!.status).toBe('matched');
    expect(Number(reconciliation!.deltaHours)).toBe(0);

    await cleanup([paperRow.id, digitalRow!.id]);
  });

  it('two logs diverging beyond tolerance route to review, never auto-accepting', async () => {
    const reportDate = '2022-02-04';
    const paperRow = await insertQueuedPaperEdtr(reportDate);

    const { db, client } = makeJobDb();
    const [digitalRow] = await db
      .insert(edtr)
      .values({ tenantId, rentalId, equipmentId, source: 'digital_entry', reportDate, status: 'extracted' })
      .returning();
    await db
      .insert(edtrLineItems)
      .values({ tenantId, edtrId: digitalRow!.id, hoursActive: '2.0', hoursIdle: '0.0' });
    await client.end();

    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day(reportDate, '8.5')])),
      stubFetchBytes,
    );

    const { db: db2, client: client2 } = makeJobDb();
    const [updatedPaper] = await db2.select().from(edtr).where(eq(edtr.id, paperRow.id));
    const [reconciliation] = await db2
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.edtrId, paperRow.id));
    await client2.end();

    expect(updatedPaper!.status).toBe('review');
    expect(reconciliation!.status).toBe('discrepancy');
    expect((reconciliation!.adjustments as { reason?: string }).reason).toBe('tolerance_exceeded');

    await cleanup([paperRow.id, digitalRow!.id]);
  });

  it('sends a low-confidence reading to review rather than auto-accepting it', async () => {
    const reportDate = '2022-06-01';
    const paperRow = await insertQueuedPaperEdtr(reportDate);

    const { db, client } = makeJobDb();
    const [digitalRow] = await db
      .insert(edtr)
      .values({ tenantId, rentalId, equipmentId, source: 'digital_entry', reportDate, status: 'extracted' })
      .returning();
    await db
      .insert(edtrLineItems)
      .values({ tenantId, edtrId: digitalRow!.id, hoursActive: '8.5', hoursIdle: '1.0' });
    await client.end();

    // Hours agree exactly; only the OCR's own certainty is below the 0.90
    // gate, which is enough on its own to require a human.
    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day(reportDate, '8.5')], 0.42)),
      stubFetchBytes,
    );

    const { db: db2, client: c2 } = makeJobDb();
    const [updated] = await db2.select().from(edtr).where(eq(edtr.id, paperRow.id));
    const [recon] = await db2
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.edtrId, paperRow.id));
    await c2.end();

    expect(updated!.status).toBe('review');
    expect((recon!.adjustments as { reason?: string }).reason).toBe('low_confidence');

    await cleanup([paperRow.id, digitalRow!.id]);
  });

  it('a page with no timesheet grid hard-fails to manual entry, never fabricating a value', async () => {
    const row = await insertQueuedPaperEdtr('2022-02-02');

    await runEdtrOcrWorker(new FixtureDocumentIntelligenceAdapter({ fields: {}, tables: [] }), stubFetchBytes);

    const { db, client } = makeJobDb();
    const [updated] = await db.select().from(edtr).where(eq(edtr.id, row.id));
    const items = await db.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, row.id));
    await client.end();

    expect(updated!.status).toBe('hard_failed');
    expect(updated!.lastError).toBe('no_timesheet_table');
    expect(items).toHaveLength(0);
  });

  it('a dated row with an unreadable total fails the whole sheet, naming the lost day', async () => {
    // The dangerous shape: the sheet reads fine except for one total. Taking
    // the readable days and dropping the rest would lose a billable day with
    // nothing downstream able to tell it ever existed.
    const row = await insertQueuedPaperEdtr('2022-02-06');

    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day('2022-02-06', '8.5'), day('2022-02-07', '')])),
      stubFetchBytes,
    );

    const { db, client } = makeJobDb();
    const [updated] = await db.select().from(edtr).where(eq(edtr.id, row.id));
    const items = await db.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, row.id));
    await client.end();

    expect(updated!.status).toBe('hard_failed');
    expect(updated!.lastError).toBe('unreadable_total_hours:2022-02-07');
    // Nothing partial was persisted: it is all days or none.
    expect(items).toHaveLength(0);
  });

  // Placed last: both leave rows behind that a subsequent worker run in this
  // file would claim, so each cleans up after itself.
  it('claims at most CLAIM_BATCH_SIZE rows and leaves the rest queued, never stranded in extracting', async () => {
    // The regression: the claim UPDATE matched every queued row and the
    // batch limit was applied to its RESULT, so rows 11..n were flipped to
    // 'extracting' with locked_at set and then never processed by anyone --
    // the claim predicate only looks at 'queued'. On any backlog over ten,
    // captures were silently lost.
    const dates = Array.from({ length: 12 }, (_, i) => `2022-03-${String(i + 1).padStart(2, '0')}`);
    const rows = [];
    for (const date of dates) rows.push(await insertQueuedPaperEdtr(date));

    // Every claimed row sees the same single-day sheet, so no row fans out
    // and the count below stays a clean measure of the batch limit.
    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter(sheet([day('2022-03-01', '8.5')])),
      stubFetchBytes,
    );

    const { db, client } = makeJobDb();
    const after = await db
      .select()
      .from(edtr)
      .where(
        inArray(
          edtr.id,
          rows.map((r) => r.id),
        ),
      );
    const statuses = after.map((r) => r.status);
    await client.end();

    // Ten processed, two untouched and still claimable on the next run.
    // Zero left mid-flight.
    expect(statuses.filter((s) => s === 'queued')).toHaveLength(2);
    expect(statuses.filter((s) => s === 'extracting')).toHaveLength(0);

    await cleanup(rows.map((r) => r.id));
  });

  it('reclaims a row abandoned in extracting by a dead worker, burning one attempt', async () => {
    const row = await insertQueuedPaperEdtr('2022-03-20');
    const { db, client } = makeJobDb();
    // What a crash between the claim UPDATE and the terminal write leaves
    // behind. Before the reaper this row was unreachable forever.
    await db
      .update(edtr)
      .set({ status: 'extracting', lockedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(edtr.id, row.id));
    await client.end();

    const fixture = new FixtureDocumentIntelligenceAdapter(sheet([day('2022-03-20', '8.5')]));
    // First run reaps it back to queued; the second claims and extracts it.
    await runEdtrOcrWorker(fixture, stubFetchBytes);
    await runEdtrOcrWorker(fixture, stubFetchBytes);

    const { db: db2, client: client2 } = makeJobDb();
    const [updated] = await db2.select().from(edtr).where(eq(edtr.id, row.id));
    await client2.end();

    expect(updated!.status).toBe('review'); // single_source, i.e. it got extracted
    // The attempt is burned so a row that reliably kills the worker cannot
    // loop forever.
    expect(updated!.attempts).toBe(1);
  });
});
