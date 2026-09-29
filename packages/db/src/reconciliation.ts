import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  evaluateGate,
  worstDelta,
  DEFAULT_TOLERANCE_HOURS,
  type HourDeltas,
  type ReconciliationReason,
} from '@arkilaunch/shared';
import type { Tx } from './with-tenant-tx.js';
import { edtr, edtrLineItems, edtrReconciliations } from './schema/index.js';


export interface ReconcileResult {
  edtrId: string;
  reconciliationId: string;
  // approved/rejected are terminal: returned unchanged, so a re-run is a no-op.
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
  // null when any line item lacks idle hours; summing NULL as 0 would fake a disagreement.
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

// Active and idle compared separately: the deduction prices hours_active alone.
function hourDeltas(a: HourSums, b: HourSums): HourDeltas {
  // Idle (and total) only when BOTH logs recorded it; never default it to zero.
  const comparableIdle = a.idle !== null && b.idle !== null;
  return {
    active: Math.abs(a.active - b.active),
    idle: comparableIdle ? Math.abs(a.idle! - b.idle!) : null,
    total: comparableIdle ? Math.abs(a.active + a.idle! - (b.active + b.idle!)) : null,
  };
}

// RFC-2 double-entry reconciliation. edtr_id is UNIQUE, so reconciling from each side
// writes two rows; safe because the gate reads only the row keyed on the approved EDTR.
// `counterpartId` pins the pairing: the equipment-day is not unique.
export async function reconcileEdtr(
  tx: Tx,
  tenantId: string,
  edtrId: string,
  opts: { counterpartId?: string } = {},
): Promise<ReconcileResult> {
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
        opts.counterpartId ? eq(edtr.id, opts.counterpartId) : undefined,
        // A decided pair's rows must never be re-paired (their status would be rewritten).
        sql`not exists (select 1 from ${edtrReconciliations} r where (r.edtr_id = ${edtr.id} and r.status in ('approved', 'rejected')) or (r.counterpart_edtr_id = ${edtr.id} and r.status = 'approved'))`,
      ),
    )
    .orderBy(desc(edtr.createdAt));
  const pairablStatuses = new Set(['extracted', 'reconciled', 'review']);
  const counterpart = candidates.find((c) => pairablStatuses.has(c.status)) ?? null;

  const [existingRecon] = await tx
    .select()
    .from(edtrReconciliations)
    .where(eq(edtrReconciliations.edtrId, edtrId))
    .limit(1);
  const tolerance = existingRecon ? Number(existingRecon.tolerance) : DEFAULT_TOLERANCE_HOURS;

  // Terminal rows are never re-opened: resetting 'approved' would let approve() deduct twice.
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
    // Single source never auto-accepts (RFC-2): always review.
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
  // Fail closed: a side with no line items sums to zero and would read as agreement.
  const noEvidence = aItems.length === 0 || bItems.length === 0;

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
