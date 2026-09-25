import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { edtr, edtrLineItems, events, reconcileEdtr, rentals, weatherAlerts } from '@arkilaunch/db';
import {
  CONFIDENCE_GATE,
  OcrPayloadSchema,
  compareReportedWeather,
  type TimedReading,
  type WeatherObservation,
  documentIntelligenceAvailability,
  parseEdtrSheet,
  type DocumentIntelligencePort,
  type EdtrSheetDay,
  type OcrPayload,
} from '@arkilaunch/shared';
import { AzureDocumentIntelligenceAdapter, EDTR_MODEL_ID } from '@arkilaunch/document-intelligence';
import { makeJobDb } from './db-client.js';
import { fetchStorageObject } from './storage.js';
import { runInstrumentedJob } from './telemetry.js';

// RFC-2 §2/§3 (RFC2-02): claim/lock/retry loop + extraction + reconciliation
// gate.
//
// One capture is one SHEET, and the real Almara sheet is a multi-day
// timesheet (docs/cr-arkilaunch-edtr-real-form.md). The worker therefore
// fans one claimed row out into one edtr row per dated line, so
// reconciliation keeps pairing on (equipment_id, report_date) and the
// deduction gate is untouched.
const MAX_ATTEMPTS = 5;
const CLAIM_BATCH_SIZE = 10;
// A row is 'extracting' only while a worker is mid-flight. A crash, an OOM
// kill, or a deploy between the claim UPDATE and the terminal write leaves
// it 'extracting' with locked_at set forever -- and the claim predicate
// below (status='queued' AND locked_at IS NULL) can never pick it up again.
// It is silently lost capture. Longer than POLL_TIMEOUT_MS (60s) in
// azure-adapter.ts plus the storage read, so this never steals a row from a
// worker that is still legitimately working on it.
const STALE_LOCK_MS = 15 * 60 * 1000;
const API_VERSION = '2024-11-30';

type Tx = Parameters<Parameters<ReturnType<typeof makeJobDb>['db']['transaction']>[0]>[0];

// The site's polled readings on one Manila day, as minutes since Manila
// midnight (weather_alerts keeps one row per 30-minute poll).
async function siteReadingsOn(
  tx: Tx,
  tenantId: string,
  rentalId: string,
  reportDate: string,
): Promise<{ siteId: string; readings: TimedReading[] } | null> {
  const [rental] = await tx.select({ siteId: rentals.projectSiteId }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);
  if (!rental?.siteId) return null;
  const dayStart = new Date(`${reportDate}T00:00:00+08:00`);
  const rows = await tx
    .select({ at: weatherAlerts.effectiveAt, observed: weatherAlerts.observed })
    .from(weatherAlerts)
    .where(
      and(
        eq(weatherAlerts.tenantId, tenantId),
        eq(weatherAlerts.projectSiteId, rental.siteId),
        gte(weatherAlerts.effectiveAt, dayStart),
        lt(weatherAlerts.effectiveAt, new Date(dayStart.getTime() + 86_400_000)),
      ),
    );
  const readings = rows
    .filter((r) => r.observed)
    .map((r) => ({ minute: Math.floor((r.at.getTime() - dayStart.getTime()) / 60_000), observed: r.observed as WeatherObservation }));
  return { siteId: rental.siteId, readings };
}

// One day's reading, as the ocr_payload JSONB contract (RFC-2 §3).
//
// hours_idle is absent rather than present-and-zero: the paper form has no
// idle column, so there is no reading to record. min_field_confidence is
// the day's own cell confidence, which is what the 0.90 gate grades.
function toOcrPayload(day: EdtrSheetDay): OcrPayload {
  const fields = [
    {
      name: 'hours_active',
      value: day.hoursActive,
      value_type: 'number' as const,
      confidence: day.confidence,
      // The TOTAL HOURS cell this reading was taken from, so the reviewer
      // is shown the figure itself rather than the whole sheet.
      ...(day.boundingRegion ? { bounding_region: day.boundingRegion } : {}),
    },
  ];
  // Recorded as a field of its own so a reviewer can see the independent
  // figure the in/out times produced, not just that the two disagreed.
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
  // Testable seam: production defaults to a real Supabase Storage signed-URL
  // fetch; jobs/src/edtr-ocr-worker.spec.ts injects a stub so tests never
  // make a real network call. Bucket comes from the same env var apps/api
  // uses for EDTR uploads (SUPABASE_STORAGE_BUCKET_EDTR).
  fetchBytes: (key: string) => Promise<Buffer> = (key) =>
    fetchStorageObject(process.env.SUPABASE_STORAGE_BUCKET_EDTR ?? 'edtr-documents', key),
) {
  // Gated by ENABLE_OCR_PIPELINE (default false), mirroring weather-poll.ts.
  // This must be checked before the availability probe below: once a real
  // adapter exists and Terraform has populated real AZURE_DI_* credentials,
  // documentIntelligenceAvailability() starts returning available:true, and
  // without this gate the cron would begin actually calling Azure DI every
  // run regardless of whether an operator asked for the pipeline.
  if (process.env.ENABLE_OCR_PIPELINE !== 'true') {
    console.log('edtr-ocr-worker: ENABLE_OCR_PIPELINE is off; skipping.');
    return;
  }

  // Fail closed BEFORE the claim UPDATE. A worker that cannot extract must
  // not flip rows to 'extracting', burn an attempt, and drop them back --
  // that churns `attempts` toward MAX_ATTEMPTS and eventually hard-fails
  // perfectly good captures for a reason that has nothing to do with them.
  // Returning early leaves every queued row exactly as it was, so the
  // moment a real adapter is configured the backlog drains normally.
  if (!port) {
    const availability = documentIntelligenceAvailability(process.env, true);
    if (!availability.available) {
      console.log(
        `edtr-ocr-worker: document extraction unavailable (${availability.reason}); claiming nothing.`,
      );
      const { db: probeDb, client: probeClient } = makeJobDb();
      try {
        // Tenant-scoped analytics need a tenant; this is a platform-level
        // degradation, so record it against every tenant that currently
        // has work waiting rather than inventing a tenant id.
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
    // Reached only once documentIntelligenceAvailability() returns
    // available:true, which now requires the flag check above to have
    // passed AND real AZURE_DI_* credentials AND a real adapter to exist.
    port = new AzureDocumentIntelligenceAdapter({
      endpoint: process.env.AZURE_DI_ENDPOINT!,
      apiKey: process.env.AZURE_DI_KEY!,
      ...(process.env.AZURE_DI_MAX_PAGES ? { maxPagesPerDocument: Number(process.env.AZURE_DI_MAX_PAGES) } : {}),
    });
  }

  const { db, client } = makeJobDb();

  try {
    // Release rows abandoned mid-extraction by a dead worker. attempts is
    // incremented so a row that reliably kills the worker walks toward
    // MAX_ATTEMPTS and routes to review, instead of being re-claimed and
    // re-crashing forever.
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

    // Claim a batch: queued, unlocked, under the retry cap.
    //
    // The LIMIT is inside the UPDATE, not applied to its result. Claiming
    // every queued row and then slicing to CLAIM_BATCH_SIZE flipped rows
    // 11..n to 'extracting' with locked_at set and then never touched them
    // -- on any backlog over ten they were stranded, since the claim
    // predicate only ever looks at 'queued' rows. Drizzle has no .limit()
    // on update, hence the subquery; FOR UPDATE SKIP LOCKED also makes two
    // concurrent workers claim disjoint batches rather than block.
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
          // Should not happen for paper_ocr (raw_file_uri is required at
          // capture time); hard-fail rather than guess.
          await db
            .update(edtr)
            .set({ status: 'hard_failed', lockedAt: null, lastError: 'missing_raw_file_uri' })
            .where(eq(edtr.id, row.id));
          continue;
        }

        // Storage read + Azure DI analyze happen OUTSIDE the DB transaction
        // below. With a real adapter these are two network round trips that
        // can take seconds; holding them inside db.transaction() would pin a
        // Supavisor transaction-mode pool connection for the whole duration,
        // per row, risking idle-in-transaction timeouts under load.
        const bytes = await fetchBytes(row.rawFileUri);
        const result = await port.analyze(EDTR_MODEL_ID, bytes);

        // The sheet's own dates are ground truth; row.reportDate is only the
        // anchor that resolves a bare "03/01" to a year.
        const sheet = parseEdtrSheet(result.tables, row.reportDate);
        if (!sheet.ok) {
          // Every refusal reason names what could not be read, so an
          // operator can tell a bad photo from a form-layout change. None of
          // them guess: a sheet that cannot be read in full goes to manual
          // entry rather than being read in part (RFC-2 §2, AGENTS.md
          // "Never").
          await db
            .update(edtr)
            .set({ status: 'hard_failed', lockedAt: null, lastError: sheet.reason })
            .where(eq(edtr.id, row.id));
          continue;
        }

        // One transaction for the whole sheet. A crash partway through must
        // not leave some days persisted and the rest lost -- the claimed row
        // would already be out of 'queued', so nothing would ever retry the
        // missing days.
        await db.transaction(async (tx) => {
          for (const [index, day] of sheet.days.entries()) {
            const ocrPayload = toOcrPayload(day);

            // The claimed row hosts the sheet's first dated line; the rest
            // become sibling rows sharing its raw file. reportDate is taken
            // from the sheet rather than from what the operator typed at
            // capture time, because the paper is the record.
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

            await tx.insert(edtrLineItems).values({
              tenantId: row.tenantId,
              edtrId,
              hoursActive: String(day.hoursActive),
              // Not zero. The form has no idle column, so nobody recorded
              // one (migration 0017).
              hoursIdle: null,
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

            // RFC-2 §2 step 5/6: pair with the other independent log and
            // apply the gate immediately after extraction.
            await reconcileEdtr(tx, row.tenantId, edtrId);

            if (day.totalMismatch) {
              // The sheet contradicts itself: the in/out times do not add up
              // to the total the operator wrote and signed. That is a human
              // question, so it overrides reconciliation even when a digital
              // counterpart happens to agree with the written total -- two
              // readings of this page already disagree.
              await tx
                .update(edtr)
                .set({
                  status: 'review',
                  lastError: `total_mismatch:written=${day.hoursActive},computed=${day.computedHours}`,
                })
                .where(eq(edtr.id, edtrId));
            }

            // EDTR v2: the timekeeper's weather and idle reason against the
            // site's own readings. A D1/D2 discrepancy logs to the S14
            // incident log and holds the day for a human; it never changes
            // money (RFC-2). tenant_id comes from the claimed row, never
            // from the sheet or its QR code.
            if (day.v2) {
              const site = await siteReadingsOn(tx, row.tenantId, row.rentalId, day.reportDate);
              const flags = site ? compareReportedWeather({ ...day.v2, hoursActive: day.hoursActive }, site.readings) : [];
              for (const flag of flags) {
                await tx.insert(events).values({
                  tenantId: row.tenantId,
                  name: 'edtr_weather_discrepancy',
                  properties: {
                    edtr_id: edtrId,
                    rental_id: row.rentalId,
                    project_site_id: site!.siteId,
                    date: day.reportDate,
                    half: flag.half,
                    rule: flag.rule,
                    reported: flag.reported,
                    system: flag.system,
                  },
                });
              }
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

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('edtr-ocr-worker', () => runEdtrOcrWorker()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
