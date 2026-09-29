import { and, eq, lt, sql } from 'drizzle-orm';
import { edtr, edtrLineItems, events, flagUsedDespiteWarning, logWeatherDiscrepancies, reconcileEdtr } from '@arkilaunch/db';
import {
  CONFIDENCE_GATE,
  OcrPayloadSchema,
  documentIntelligenceAvailability,
  parseEdtrSheet,
  validateDayEntry,
  type DocumentIntelligencePort,
  type EdtrSheetDay,
  type OcrPayload,
} from '@arkilaunch/shared';
import { createDocumentIntelligenceAdapter, EDTR_MODEL_ID } from '@arkilaunch/document-intelligence';
import { makeJobDb } from './db-client.js';
import { fetchStorageObject } from './storage.js';
import { runJobIfMain } from './telemetry.js';

// One capture is one multi-day sheet; it fans out into one edtr row per dated
// line so reconciliation keeps pairing on (equipment_id, report_date).
const MAX_ATTEMPTS = 5;
const CLAIM_BATCH_SIZE = 10;
// Must exceed azure-adapter POLL_TIMEOUT_MS plus the storage read, or a live
// worker's row gets stolen.
const STALE_LOCK_MS = 15 * 60 * 1000;
const API_VERSION = '2024-11-30';

function toOcrPayload(day: EdtrSheetDay): OcrPayload {
  const fields = [
    {
      name: 'hours_active',
      value: day.hoursActive,
      value_type: 'number' as const,
      confidence: day.confidence,
      ...(day.boundingRegion ? { bounding_region: day.boundingRegion } : {}),
    },
  ];
  if (day.computedHours !== null) {
    fields.push({
      name: 'hours_computed_from_times',
      value: day.computedHours,
      value_type: 'number' as const,
      confidence: day.confidence,
    });
  }

  return OcrPayloadSchema.parse({
    model_id: EDTR_MODEL_ID,
    api_version: API_VERSION,
    analyzed_at: new Date().toISOString(),
    fields,
    min_field_confidence: day.confidence,
    pages: 1,
  });
}

export async function runEdtrOcrWorker(
  port?: DocumentIntelligencePort,
  fetchBytes: (key: string) => Promise<Buffer> = (key) =>
    fetchStorageObject(process.env.SUPABASE_STORAGE_BUCKET_EDTR ?? 'edtr-documents', key),
) {
  // Checked before the availability probe: real AZURE_DI_* creds alone must
  // not start calling Azure DI.
  if (process.env.ENABLE_OCR_PIPELINE !== 'true') {
    console.log('edtr-ocr-worker: ENABLE_OCR_PIPELINE is off; skipping.');
    return;
  }

  // Fail closed before claiming, so an unavailable adapter never burns
  // attempts on good captures.
  if (!port) {
    const availability = documentIntelligenceAvailability(process.env);
    if (!availability.available) {
      console.log(
        `edtr-ocr-worker: document extraction unavailable (${availability.reason}); claiming nothing.`,
      );
      const { db: probeDb, client: probeClient } = makeJobDb();
      try {
        const waiting = await probeDb.selectDistinct({ tenantId: edtr.tenantId }).from(edtr).where(eq(edtr.status, 'queued'));
        for (const row of waiting) {
          await probeDb.insert(events).values({
            tenantId: row.tenantId,
            name: 'external_dependency_degraded',
            properties: { dependency: 'azure_document_intelligence', mode: 'unavailable', reason: availability.reason },
          });
        }
      } finally {
        await probeClient.end();
      }
      return;
    }
    port = createDocumentIntelligenceAdapter(process.env);
  }

  const { db, client } = makeJobDb();

  try {
    // attempts++ so a row that reliably kills the worker ends in review.
    const reaped = await db
      .update(edtr)
      .set({
        status: 'queued',
        lockedAt: null,
        attempts: sql`${edtr.attempts} + 1`,
        lastError: 'stale_lock_reclaimed',
      })
      .where(and(eq(edtr.status, 'extracting'), lt(edtr.lockedAt, new Date(Date.now() - STALE_LOCK_MS))))
      .returning({ id: edtr.id });
    if (reaped.length > 0) {
      console.warn(`edtr-ocr-worker: reclaimed ${reaped.length} row(s) stuck in 'extracting'.`);
    }

    // LIMIT must sit inside the UPDATE (Drizzle has no update .limit());
    // SKIP LOCKED gives concurrent workers disjoint batches.
    const batch = await db
      .update(edtr)
      .set({ status: 'extracting', lockedAt: new Date() })
      .where(
        sql`${edtr.id} in (select id from edtr where status = 'queued' and locked_at is null and attempts < ${MAX_ATTEMPTS} order by created_at limit ${CLAIM_BATCH_SIZE} for update skip locked)`,
      )
      .returning();
    console.log(`edtr-ocr-worker: claimed ${batch.length} row(s).`);

    for (const row of batch) {
      try {
        if (!row.rawFileUri) {
          await db
            .update(edtr)
            .set({ status: 'hard_failed', lockedAt: null, lastError: 'missing_raw_file_uri' })
            .where(eq(edtr.id, row.id));
          continue;
        }

        // Network calls stay outside the transaction so they don't pin a
        // Supavisor pooler connection.
        const bytes = await fetchBytes(row.rawFileUri);
        const result = await port.analyze(EDTR_MODEL_ID, bytes);

        const sheet = parseEdtrSheet(result.tables, row.reportDate);
        if (!sheet.ok) {
          // RFC-2: a sheet not readable in full is never read in part.
          await db
            .update(edtr)
            .set({ status: 'hard_failed', lockedAt: null, lastError: sheet.reason })
            .where(eq(edtr.id, row.id));
          continue;
        }

        await db.transaction(async (tx) => {
          for (const [index, day] of sheet.days.entries()) {
            const ocrPayload = toOcrPayload(day);

            let edtrId = row.id;
            if (index === 0) {
              await tx
                .update(edtr)
                .set({ status: 'extracted', reportDate: day.reportDate, ocrPayload, lockedAt: null, lastError: null })
                .where(eq(edtr.id, row.id));
            } else {
              const [sibling] = await tx
                .insert(edtr)
                .values({
                  tenantId: row.tenantId,
                  rentalId: row.rentalId,
                  equipmentId: row.equipmentId,
                  source: row.source,
                  reportDate: day.reportDate,
                  rawFileUri: row.rawFileUri,
                  ocrPayload,
                  status: 'extracted',
                })
                .returning({ id: edtr.id });
              edtrId = sibling!.id;
            }

            // No idle column on pre-v3 forms: NULL, not zero.
            const v3 = day.v3;
            const opt = (n: number | null | undefined) => (n == null ? null : String(n));
            const reviewFlags = v3
              ? validateDayEntry({
                  running: v3.running,
                  idle: v3.idle,
                  breakdown: v3.breakdown,
                  weather: v3.weather,
                  otherDowntime: v3.other,
                  total: v3.total,
                  meterStart: v3.meterStart,
                  meterEnd: v3.meterEnd,
                  weatherAm: day.v2?.weatherAm ?? null,
                  weatherPm: day.v2?.weatherPm ?? null,
                })
              : [];
            await tx.insert(edtrLineItems).values({
              tenantId: row.tenantId,
              edtrId,
              hoursActive: String(day.hoursActive),
              hoursIdle: v3 ? opt(v3.idle) : null,
              hoursTotal: opt(v3?.total),
              hoursBreakdown: opt(v3?.breakdown),
              hoursWeather: opt(v3?.weather),
              hoursOtherDowntime: opt(v3?.other),
              hourMeterStart: opt(v3?.meterStart),
              hourMeterEnd: opt(v3?.meterEnd),
              reviewFlags,
            });

            for (const field of ocrPayload.fields) {
              await tx.insert(events).values({
                tenantId: row.tenantId,
                name: 'ocr_field_confidence',
                properties: {
                  doc_type: 'edtr',
                  field: field.name,
                  confidence: field.confidence,
                  auto_accepted: field.confidence >= CONFIDENCE_GATE,
                },
              });
            }

            // RFC-2 money gate: reconcile before anything can deduct.
            await reconcileEdtr(tx, row.tenantId, edtrId);
            await flagUsedDespiteWarning(tx, row.tenantId, edtrId);

            if (day.totalMismatch) {
              // A self-contradicting sheet overrides a passing reconciliation.
              await tx
                .update(edtr)
                .set({
                  status: 'review',
                  lastError: `total_mismatch:written=${day.hoursActive},computed=${day.computedHours}`,
                })
                .where(eq(edtr.id, edtrId));
            }

            // Evidence only, never money. tenant_id from the claimed row, never the sheet.
            if (day.v2) {
              const flags = await logWeatherDiscrepancies(tx, row.tenantId, edtrId, row.rentalId, day.reportDate, {
                ...day.v2,
                hoursActive: day.hoursActive,
              });
              if (flags.length > 0) {
                const reason = `weather_${flags.map((f) => `${f.rule}:${f.half}`).join(',')}`;
                await tx
                  .update(edtr)
                  .set({
                    status: 'review',
                    lastError: day.totalMismatch
                      ? sql`coalesce(${edtr.lastError} || ';', '') || ${reason}`
                      : reason,
                  })
                  .where(eq(edtr.id, edtrId));
              }
            }
          }
        });

        if (sheet.days.length > 1) {
          console.log(`edtr-ocr-worker: sheet ${row.id} fanned out into ${sheet.days.length} day rows.`);
        }
      } catch (err) {
        const attempts = row.attempts + 1;
        const lastError = err instanceof Error ? err.message : String(err);
        const nextStatus = attempts >= MAX_ATTEMPTS ? 'review' : 'queued';
        await db.update(edtr).set({ status: nextStatus, lockedAt: null, attempts, lastError }).where(eq(edtr.id, row.id));
        console.error(`edtr-ocr-worker: extraction failed for edtr ${row.id} (attempt ${attempts}):`, err);
      }
    }
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'edtr-ocr-worker', runEdtrOcrWorker);
