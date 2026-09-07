import { and, eq, isNull, lt } from 'drizzle-orm';
import { edtr, edtrLineItems, events, reconcileEdtr } from '@arkilaunch/db';
import {
  OcrPayloadSchema,
  documentIntelligenceAvailability,
  type DocumentIntelligencePort,
  type OcrPayload,
} from '@arkilaunch/shared';
import { AzureDocumentIntelligenceAdapter } from '@arkilaunch/document-intelligence';
import { makeJobDb } from './db-client.js';
import { fetchStorageObject } from './storage.js';
import { runInstrumentedJob } from './telemetry.js';

// RFC-2 §2/§3 (RFC2-02): claim/lock/retry loop + extraction + reconciliation
// gate.
//
// NOTE: EDTR_MODEL_ID below names a custom neural model that DOES NOT EXIST
// yet. Training it needs labeled Almara sheets, and the field names this
// worker keys on (hours_active/hours_idle) are a guess until that training
// run fixes the labels. Recorded in cr-arkilaunch-pilot-honesty.md §4.
const MAX_ATTEMPTS = 5;
const CLAIM_BATCH_SIZE = 10;
const EDTR_MODEL_ID = 'arkilaunch-edtr-neural-v1';
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
    // Claim a batch: queued, unlocked, under the retry cap (matches the
    // partial index edtr_worker_claim_idx from the RFC2-01 migration).
    const claimed = await db
      .update(edtr)
      .set({ status: 'extracting', lockedAt: new Date() })
      .where(and(eq(edtr.status, 'queued'), isNull(edtr.lockedAt), lt(edtr.attempts, MAX_ATTEMPTS)))
      .returning();

    const batch = claimed.slice(0, CLAIM_BATCH_SIZE);
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
        const hoursActive = fieldNumber(ocrPayload, 'hours_active');
        const hoursIdle = fieldNumber(ocrPayload, 'hours_idle');

        if (hoursActive === null || hoursIdle === null) {
          // A field the model did not return is not zero hours -- writing 0
          // would be a fabricated reading handed to the deduction gate as
          // real (RFC-2 §2, AGENTS.md "Never"). Hard-fail to manual entry.
          await db
            .update(edtr)
            .set({ status: 'hard_failed', lockedAt: null, lastError: 'missing_required_field' })
            .where(eq(edtr.id, row.id));
          continue;
        }

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
