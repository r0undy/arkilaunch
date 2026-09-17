import { and, eq, lt, sql } from 'drizzle-orm';
import { edtr, edtrLineItems, events, reconcileEdtr } from '@arkilaunch/db';
import {
  OcrPayloadSchema,
  documentIntelligenceAvailability,
  type DocumentIntelligencePort,
  type OcrPayload,
} from '@arkilaunch/shared';
import {
  AzureDocumentIntelligenceAdapter,
  EDTR_MODEL_ID,
  EDTR_REQUIRED_FIELDS,
} from '@arkilaunch/document-intelligence';
import { makeJobDb } from './db-client.js';
import { fetchStorageObject } from './storage.js';
import { runInstrumentedJob } from './telemetry.js';

// RFC-2 §2/§3 (RFC2-02): claim/lock/retry loop + extraction + reconciliation
// gate.
//
// EDTR_MODEL_ID and EDTR_REQUIRED_FIELDS come from
// @arkilaunch/document-intelligence's model registry, which is the one place
// that knows what a logical model id really is and what it returns. Both are
// still awaiting a training run over labeled Almara sheets -- see the caveats
// recorded against them there and in cr-arkilaunch-pilot-honesty.md §4.
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

function toOcrPayload(fields: Record<string, { value: string; confidence: number }>): OcrPayload {
  const parsedFields = Object.entries(fields).map(([name, field]) => {
    const numeric = Number(field.value);
    const isNumber = Number.isFinite(numeric) && field.value.trim() !== '';
    return {
      name,
      value: isNumber ? numeric : field.value,
      value_type: (isNumber ? 'number' : 'string') as 'number' | 'string',
      confidence: field.confidence,
    };
  });
  const minConfidence = parsedFields.length > 0 ? Math.min(...parsedFields.map((f) => f.confidence)) : 0;

  return OcrPayloadSchema.parse({
    model_id: EDTR_MODEL_ID,
    api_version: API_VERSION,
    analyzed_at: new Date().toISOString(),
    fields: parsedFields,
    min_field_confidence: minConfidence,
    pages: 1,
  });
}

function requireField(values: Map<string, number>, name: string): number {
  const value = values.get(name);
  if (value === undefined) {
    // Lands in the per-row catch: the row retries and eventually routes to
    // review. It never becomes a persisted reading.
    throw new Error(`required field ${name} passed validation but is absent`);
  }
  return value;
}

function fieldNumber(payload: OcrPayload, name: string): number | null {
  const field = payload.fields.find((f) => f.name === name);
  return field && typeof field.value === 'number' ? field.value : null;
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
        const hasFields = Object.keys(result.fields).length > 0;

        if (!hasFields) {
          // Unreadable/corrupt input hard-fails to manual entry; never
          // fabricate a value (RFC-2 §2, AGENTS.md "Never").
          await db
            .update(edtr)
            .set({ status: 'hard_failed', lockedAt: null, lastError: 'unreadable_or_empty_extraction' })
            .where(eq(edtr.id, row.id));
          continue;
        }

        const ocrPayload = toOcrPayload(result.fields);
        // One pass builds the values and finds the gaps, so there is no way
        // for the check and the read to disagree about what was present.
        const required = new Map<string, number>();
        const missing: string[] = [];
        for (const name of EDTR_REQUIRED_FIELDS) {
          const value = fieldNumber(ocrPayload, name);
          if (value === null) missing.push(name);
          else required.set(name, value);
        }

        if (missing.length > 0) {
          // A field the model did not return is not zero hours -- writing 0
          // would be a fabricated reading handed to the deduction gate as
          // real (RFC-2 §2, AGENTS.md "Never"). Hard-fail to manual entry,
          // naming the fields so an operator can tell a model-schema drift
          // apart from a genuinely illegible sheet.
          await db
            .update(edtr)
            .set({
              status: 'hard_failed',
              lockedAt: null,
              lastError: `missing_required_field:${missing.join(',')}`,
            })
            .where(eq(edtr.id, row.id));
          continue;
        }

        // Unreachable: the missing-field branch above returns for exactly
        // these names. It throws rather than defaulting because a `?? 0` here
        // would be the fabricated zero this whole path exists to prevent --
        // and an unreachable default is still the wrong value to write down
        // in a file where zero means "the machine idled".
        const hoursActive = requireField(required, 'hours_active');
        const hoursIdle = requireField(required, 'hours_idle');

        await db.transaction(async (tx) => {
          await tx.update(edtr).set({ status: 'extracted', ocrPayload, lockedAt: null }).where(eq(edtr.id, row.id));

          await tx.insert(edtrLineItems).values({
            tenantId: row.tenantId,
            edtrId: row.id,
            hoursActive: String(hoursActive),
            hoursIdle: String(hoursIdle),
          });

          for (const field of ocrPayload.fields) {
            await tx.insert(events).values({
              tenantId: row.tenantId,
              name: 'ocr_field_confidence',
              properties: {
                doc_type: 'edtr',
                field: field.name,
                confidence: field.confidence,
                auto_accepted: field.confidence >= 0.9,
              },
            });
          }

          // RFC-2 §2 step 5/6: pair with the other independent log and
          // apply the gate immediately after extraction.
          await reconcileEdtr(tx, row.tenantId, row.id);
        });
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
