import { and, eq, ne } from 'drizzle-orm';
import {
  evaluateGate,
  worstDelta,
  DEFAULT_TOLERANCE_HOURS,
  type HourDeltas,
  type ReconciliationReason,
} from '@arkilaunch/shared';
import { db } from './client.js';
import { edtr, edtrLineItems, edtrReconciliations } from './schema/index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ReconcileResult {
  edtrId: string;
  reconciliationId: string;
  // 'approved' and 'rejected' are terminal: reconcileEdtr reports them
  // back unchanged rather than re-deriving them, so a re-run over an
  // already-decided pair is a no-op (audit-ocr-money-path.md #6).
  status: 'pending' | 'matched' | 'discrepancy' | 'approved' | 'rejected';
  counterpartEdtrId: string | null;
  deltaHours: number | null;
  reason: ReconciliationReason | null;
}

function minFieldConfidence(source: string, ocrPayload: unknown): number {
  // digital_entry has no OCR step; treated as full confidence (RFC-2 §2).
  if (source !== 'paper_ocr') return 1;
  const payload = ocrPayload as { min_field_confidence?: number } | null;
  return payload?.min_field_confidence ?? 0;
}

interface HourSums {
  active: number;
  // null when ANY line item on this side did not record idle hours, which
  // is the normal case for a paper capture -- the real Almara form has no
  // idle column (migration 0017). Summing a NULL as 0 would understate the
  // total and manufacture a disagreement with a log that did record it.
  idle: number | null;
}

function sumHours(items: Array<{ hoursActive: string; hoursIdle: string | null }>): HourSums {
  return items.reduce<HourSums>(
    (acc, item) => ({
      active: acc.active + Number(item.hoursActive),
      idle: acc.idle === null || item.hoursIdle === null ? null : acc.idle + Number(item.hoursIdle),
    }),
    { active: 0, idle: 0 },
  );
}

// active and idle are compared as their own dimensions, not folded into one
// number, because the deduction prices hours_active alone -- see the
// evaluateGate() comment in packages/shared/src/edtr.ts for the
// offsetting-misclassification hole this closes. `total` is kept as a third
// dimension so the new gate cannot be looser than the summed-total one it
// replaces.
function hourDeltas(a: HourSums, b: HourSums): HourDeltas {
  // Idle is only comparable when BOTH logs recorded it. If either did not,
  // the idle dimension and the summed total that contains it are dropped
  // and the gate decides on active hours alone -- which is the figure the
  // deduction is priced on. See the HourDeltas comment in
  // packages/shared/src/edtr.ts for why this is not defaulted to zero.
  const comparableIdle = a.idle !== null && b.idle !== null;
  return {
    active: Math.abs(a.active - b.active),
    idle: comparableIdle ? Math.abs(a.idle! - b.idle!) : null,
    total: comparableIdle ? Math.abs(a.active + a.idle! - (b.active + b.idle!)) : null,
  };
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

  // A terminal reconciliation is not re-openable by re-running the machine
  // over it. Both write paths below used an unconditional `.set(values)`,
  // so any future caller, manual re-reconcile or backfill would reset an
  // 'approved' row to 'matched'/'pending' -- and approve() would then
  // deduct a second time against the same equipment-day. No caller does
  // this today, which is what made it latent rather than live
  // (audit-ocr-money-path.md #6). approve()'s in-transaction status check
  // plus FOR UPDATE closes the concurrent-HTTP race; this closes the one
  // outside that transaction. Guarded here, before either branch, so
  // neither can drift from the other.
  if (existingRecon && (existingRecon.status === 'approved' || existingRecon.status === 'rejected')) {
    return {
      edtrId: record.id,
      reconciliationId: existingRecon.id,
      status: existingRecon.status as ReconcileResult['status'],
      counterpartEdtrId: existingRecon.counterpartEdtrId,
      deltaHours: existingRecon.deltaHours === null ? null : Number(existingRecon.deltaHours),
      reason: (existingRecon.adjustments as { reason?: ReconciliationReason } | null)?.reason ?? null,
    };
  }

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
  // A side with no line items at all sums to zero in every dimension, which
  // would otherwise read as perfect agreement and auto-accept a pair that
  // carries no evidence whatsoever. Fail closed instead: this is the money
  // path, and "no hours recorded" is a reason for a human to look, never a
  // reason to match. reconcileEdtr() is reachable from the worker
  // (jobs/src/edtr-ocr-worker.ts) as well as from capture, so this cannot
  // rely on the caller having validated line items.
  const noEvidence = aItems.length === 0 || bItems.length === 0;

  // Deltas are only meaningful when both sides actually recorded hours.
  // Measuring against an absent log would persist a delta computed against
  // a phantom all-zero side -- a reviewer would read "the logs disagree
  // about 8 active hours" when the truth is that one log has no hours at
  // all. null instead, exactly as the single_source branch above does.
  const deltas = noEvidence ? null : hourDeltas(sumHours(aItems), sumHours(bItems));
  const deltaHours = deltas ? worstDelta(deltas) : null;

  const gate =
    deltas === null
      ? { matched: false, reason: 'unreadable' as ReconciliationReason }
      : evaluateGate(
          minFieldConfidence(record.source, record.ocrPayload),
          minFieldConfidence(counterpart.source, counterpart.ocrPayload),
          deltas,
          tolerance,
        );
  const status = gate.matched ? ('matched' as const) : ('discrepancy' as const);
  const edtrStatus = gate.matched ? 'reconciled' : 'review';

  const values = {
    tenantId,
    edtrId: record.id,
    counterpartEdtrId: counterpart.id,
    deltaHours: deltaHours === null ? null : String(deltaHours),
    tolerance: String(tolerance),
    status,
    // `deltas` is the per-dimension breakdown behind the single delta_hours
    // scalar, so a reviewer can see WHICH dimension diverged rather than
    // just that something did. Lives in the existing free-form jsonb
    // alongside `reason`; no schema change.
    adjustments: { reason: gate.reason, deltas },
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
