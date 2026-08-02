import { and, eq, ne } from 'drizzle-orm';
import { evaluateGate, DEFAULT_TOLERANCE_HOURS, type ReconciliationReason } from '@arkilaunch/shared';
import { db } from './client.js';
import { edtr, edtrLineItems, edtrReconciliations } from './schema/index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ReconcileResult {
  edtrId: string;
  reconciliationId: string;
  status: 'pending' | 'matched' | 'discrepancy';
  counterpartEdtrId: string | null;
  deltaHours: number | null;
  reason: ReconciliationReason;
}

function minFieldConfidence(source: string, ocrPayload: unknown): number {
  // digital_entry has no OCR step; treated as full confidence (RFC-2 §2).
  if (source !== 'paper_ocr') return 1;
  const payload = ocrPayload as { min_field_confidence?: number } | null;
  return payload?.min_field_confidence ?? 0;
}

function sumHours(items: Array<{ hoursActive: string; hoursIdle: string }>): number {
  return items.reduce((sum, item) => sum + Number(item.hoursActive) + Number(item.hoursIdle), 0);
}

// RFC-2 §2/§3 double-entry reconciliation, run by the edtr-ocr-worker after
// extraction (jobs/src/edtr-ocr-worker.ts) and re-runnable from the API
// whenever a second log lands. Shared here (not in apps/api or jobs alone)
// because both need the same DB-touching orchestration around the pure
// evaluateGate() in packages/shared.
//
// One nuance: edtr_reconciliations.edtr_id is UNIQUE per row, so pairing A
// with B and (later) reconciling from B's side creates two rows, one keyed
// on each edtr id, both pointing at the same counterpart and the same
// computed delta/status. This is redundant but not unsafe: the deduction
// gate (RFC2-04) only ever reads the reconciliation row keyed on the EDTR
// the admin is approving, so duplication here does not weaken the gate.
export async function reconcileEdtr(tx: Tx, tenantId: string, edtrId: string): Promise<ReconcileResult> {
  const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
  if (!record) throw new Error(`edtr row ${edtrId} not found`);

  const candidates = await tx
    .select()
    .from(edtr)
    .where(
      and(
        eq(edtr.tenantId, tenantId),
        eq(edtr.equipmentId, record.equipmentId),
        eq(edtr.reportDate, record.reportDate),
        ne(edtr.id, record.id),
        ne(edtr.source, record.source),
      ),
    );
  const pairablStatuses = new Set(['extracted', 'reconciled', 'review']);
  const counterpart = candidates.find((c) => pairablStatuses.has(c.status)) ?? null;

  const [existingRecon] = await tx
    .select()
    .from(edtrReconciliations)
    .where(eq(edtrReconciliations.edtrId, edtrId))
    .limit(1);
  const tolerance = existingRecon ? Number(existingRecon.tolerance) : DEFAULT_TOLERANCE_HOURS;

  if (!counterpart) {
    // AwaitingCounterpart in the RFC-2 stateDiagram: only one of the two
    // independent logs exists so far. A single source can never auto-accept
    // (RFC-2 §2 "that would defeat the whole point"), so this always routes
    // to review, not a silent wait state.
    const values = {
      tenantId,
      edtrId: record.id,
      counterpartEdtrId: null,
      deltaHours: null,
      tolerance: String(tolerance),
      status: 'pending' as const,
      adjustments: { reason: 'single_source' as ReconciliationReason },
    };
    const [reconciliation] = existingRecon
      ? await tx
          .update(edtrReconciliations)
          .set(values)
          .where(eq(edtrReconciliations.id, existingRecon.id))
          .returning()
      : await tx.insert(edtrReconciliations).values(values).returning();
    await tx.update(edtr).set({ status: 'review' }).where(eq(edtr.id, record.id));

    return {
      edtrId: record.id,
      reconciliationId: reconciliation!.id,
      status: 'pending',
      counterpartEdtrId: null,
      deltaHours: null,
      reason: 'single_source',
    };
  }

  const [aItems, bItems] = await Promise.all([
    tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, record.id)),
    tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, counterpart.id)),
  ]);
  const deltaHours = Math.abs(sumHours(aItems) - sumHours(bItems));

  const gate = evaluateGate(
    minFieldConfidence(record.source, record.ocrPayload),
    minFieldConfidence(counterpart.source, counterpart.ocrPayload),
    deltaHours,
    tolerance,
  );
  const status = gate.matched ? ('matched' as const) : ('discrepancy' as const);
  const edtrStatus = gate.matched ? 'reconciled' : 'review';

  const values = {
    tenantId,
    edtrId: record.id,
    counterpartEdtrId: counterpart.id,
    deltaHours: String(deltaHours),
    tolerance: String(tolerance),
    status,
    adjustments: { reason: gate.reason },
  };
  const [reconciliation] = existingRecon
    ? await tx.update(edtrReconciliations).set(values).where(eq(edtrReconciliations.id, existingRecon.id)).returning()
    : await tx.insert(edtrReconciliations).values(values).returning();

  await tx.update(edtr).set({ status: edtrStatus }).where(eq(edtr.id, record.id));
  await tx.update(edtr).set({ status: edtrStatus }).where(eq(edtr.id, counterpart.id));

  return {
    edtrId: record.id,
    reconciliationId: reconciliation!.id,
    status,
    counterpartEdtrId: counterpart.id,
    deltaHours,
    reason: gate.reason,
  };
}
