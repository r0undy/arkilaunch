import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { edtr, edtrReconciliations } from '@arkilaunch/db';
import { FixtureDocumentIntelligenceAdapter } from '@arkilaunch/shared/testing';
import { runEdtrOcrWorker } from './edtr-ocr-worker.js';
import { makeJobDb } from './db-client.js';

// RFC-2 §2/§3 (RFC2-02/RFC2-03): the worker's claim/extract/reconcile loop,
// run against the stub-equivalent FixtureDocumentIntelligenceAdapter so it
// is fully exercisable offline (no live Azure DI resource).
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
  // edtr-ocr-worker.ts); these tests exercise the claim/extract/reconcile
  // loop itself, so they always run with the flag on.
  beforeEach(() => {
    process.env.ENABLE_OCR_PIPELINE = 'true';
  });

  // The worker fetches document bytes via a Supabase Storage signed URL
  // before calling port.analyze(); these tests exercise the fixture adapter
  // (which ignores the buffer contents) so this stub avoids a real network
  // call. The fixture adapters don't read the bytes, so any Buffer is fine.
  const stubFetchBytes = async () => Buffer.from('fixture-bytes');

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

  it('extracts high-confidence fields, and with no counterpart yet routes to review (single_source)', async () => {
    const row = await insertQueuedPaperEdtr('2020-02-01');
    const fixture = new FixtureDocumentIntelligenceAdapter({
      fields: {
        hours_active: { value: '8.0', confidence: 0.97 },
        hours_idle: { value: '1.0', confidence: 0.96 },
      },
    });

    await runEdtrOcrWorker(fixture, stubFetchBytes);

    const { db, client } = makeJobDb();
    const [updated] = await db.select().from(edtr).where(eq(edtr.id, row.id));
    await client.end();

    expect(updated!.status).toBe('review'); // single independent log so far
    expect(updated!.ocrPayload).toBeTruthy();
  });

  it('an unreadable/empty extraction hard-fails to manual entry, never fabricating a value', async () => {
    const row = await insertQueuedPaperEdtr('2020-02-02');
    const emptyFixture = new FixtureDocumentIntelligenceAdapter({ fields: {} });

    await runEdtrOcrWorker(emptyFixture, stubFetchBytes);

    const { db, client } = makeJobDb();
    const [updated] = await db.select().from(edtr).where(eq(edtr.id, row.id));
    await client.end();

    expect(updated!.status).toBe('hard_failed');
    expect(updated!.lastError).toBe('unreadable_or_empty_extraction');
  });

  it('two matching independent logs (both above the confidence gate, within tolerance) auto-accept', async () => {
    const reportDate = '2020-02-03';
    const paperRow = await insertQueuedPaperEdtr(reportDate);

    // The second independent log: a digital_entry counterpart, already
    // extracted with matching hours (RFC-2 "two independent logs" pairing).
    const { db, client } = makeJobDb();
    const [digitalRow] = await db
      .insert(edtr)
      .values({
        tenantId,
        rentalId,
        equipmentId,
        source: 'digital_entry',
        reportDate,
        status: 'extracted',
      })
      .returning();
    const { edtrLineItems } = await import('@arkilaunch/db');
    await db.insert(edtrLineItems).values({
      tenantId,
      edtrId: digitalRow!.id,
      hoursActive: '8.0',
      hoursIdle: '1.0',
    });
    await client.end();

    const fixture = new FixtureDocumentIntelligenceAdapter({
      fields: {
        hours_active: { value: '8.0', confidence: 0.95 },
        hours_idle: { value: '1.0', confidence: 0.94 },
      },
    });
    await runEdtrOcrWorker(fixture, stubFetchBytes);

    const { db: db2, client: client2 } = makeJobDb();
    const [updatedPaper] = await db2.select().from(edtr).where(eq(edtr.id, paperRow.id));
    const [reconciliation] = await db2
      .select()
      .from(edtrReconciliations)
      .where(and(eq(edtrReconciliations.edtrId, paperRow.id)));
    await client2.end();

    expect(updatedPaper!.status).toBe('reconciled');
    expect(reconciliation!.status).toBe('matched');
    expect(Number(reconciliation!.deltaHours)).toBe(0);
  });

  it('two logs diverging beyond tolerance route to review, never auto-accepting', async () => {
    const reportDate = '2020-02-04';
    const paperRow = await insertQueuedPaperEdtr(reportDate);

    const { db, client } = makeJobDb();
    const [digitalRow] = await db
      .insert(edtr)
      .values({ tenantId, rentalId, equipmentId, source: 'digital_entry', reportDate, status: 'extracted' })
      .returning();
    const { edtrLineItems } = await import('@arkilaunch/db');
    await db.insert(edtrLineItems).values({
      tenantId,
      edtrId: digitalRow!.id,
      hoursActive: '2.0', // wildly different from the 8.0 the paper log will report
      hoursIdle: '0.0',
    });
    await client.end();

    const fixture = new FixtureDocumentIntelligenceAdapter({
      fields: {
        hours_active: { value: '8.0', confidence: 0.95 },
        hours_idle: { value: '1.0', confidence: 0.94 },
      },
    });
    await runEdtrOcrWorker(fixture, stubFetchBytes);

    const { db: db2, client: client2 } = makeJobDb();
    const [updatedPaper] = await db2.select().from(edtr).where(eq(edtr.id, paperRow.id));
    const [reconciliation] = await db2
      .select()
      .from(edtrReconciliations)
      .where(and(eq(edtrReconciliations.edtrId, paperRow.id)));
    await client2.end();

    expect(updatedPaper!.status).toBe('review');
    expect(reconciliation!.status).toBe('discrepancy');
    const adjustments = reconciliation!.adjustments as { reason?: string };
    expect(adjustments.reason).toBe('tolerance_exceeded');
  });
});
