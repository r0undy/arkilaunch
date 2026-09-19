import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
  invoiceLineItems,
  invoices,
  rateCards,
  rentals,
  reconcileEdtr,
  resolveDepositLedger,
  timekeeperSiteAssignments,
  withTenantTx,
} from '@arkilaunch/db';
import {
  CONFIDENCE_GATE,
  buildManualTranscriptionPayload,
  isManualTranscription,
  type HourDeltas,
  type EdtrApproveRequest,
  type EdtrCaptureRequest,
  type EdtrCaptureResponse,
  type EdtrDetailResponse,
  type EdtrListQuery,
  type EdtrRejectRequest,
  type OcrPayload,
  type ReconciliationReason,
  type RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { isOcrPipelineEnabled } from '../ports/document-intelligence.port.js';
import { round2HalfUp } from '../quotes/pricing-engine.service.js';

// Calendar day that a bare `date` column means. Fixed rather than
// per-tenant because the product is PH-only (docs/clr-arkilaunch.md gap E1,
// and the Azure region is southeastasia for the same reason); if tenants
// ever span zones, this belongs on `tenants` and not in a constant here.
const TENANT_TIME_ZONE = 'Asia/Manila';

@Injectable()
export class EdtrService {
  constructor(private readonly events: EventsService) {}

  // POST /api/v1/edtr (RFC-2 §3). Enforces the US-02 AC2 site-scope check
  // for timekeepers before anything is written.
  async capture(ctx: RequestContext, body: EdtrCaptureRequest): Promise<EdtrCaptureResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, body.rentalId)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'rental_not_found' });

      if (ctx.role === 'timekeeper') {
        const assigned = await tx
          .select()
          .from(timekeeperSiteAssignments)
          .where(
            and(
              eq(timekeeperSiteAssignments.tenantId, ctx.tenantId),
              eq(timekeeperSiteAssignments.userId, ctx.userId),
              eq(timekeeperSiteAssignments.projectSiteId, rental.projectSiteId),
            ),
          );
        if (assigned.length === 0) {
          await tx.insert(auditLogs).values({
            tenantId: ctx.tenantId,
            actorId: ctx.userId,
            action: 'CREATE',
            entity: 'edtr_site_scope_denied',
            entityId: rental.id,
          });
          await this.events.emit(ctx, 'edtr_site_scope_denied', { rental_id: rental.id, project_site_id: rental.projectSiteId });
          throw new ForbiddenException({ error: 'site_not_assigned' });
        }
      }

      // Manual transcription (cr-arkilaunch-pilot-honesty.md §2.1).
      //
      // Reconciliation pairs one paper_ocr row with one digital_entry row
      // (packages/db/src/reconciliation.ts uses ne(source)). With no OCR
      // adapter a paper row could never carry line items, so no pair could
      // ever form, so every log stalled at single_source -> pending and
      // approve() rejected it with 422 -- meaning NO deposit deduction was
      // approvable at all. RFC-2 already specifies that a hard extraction
      // failure "routes to manual entry and re-enters the pipeline as a
      // second log"; this makes that path reachable at capture time.
      //
      // The two logs stay genuinely independent (the timekeeper's reading
      // at the site, the PM's from their own record), so the tolerance
      // gate, the FOR UPDATE pair lock, and 409 already_approved all keep
      // working at full strength.
      const ocrWillRun = isOcrPipelineEnabled();
      if (body.source === 'paper_ocr') {
        if (ocrWillRun && body.lineItems) {
          // Ambiguous: the worker would overwrite whatever was typed here.
          throw new UnprocessableEntityException({
            error: 'line_items_not_accepted',
            detail: 'The OCR pipeline is enabled; hours are extracted from the uploaded sheet.',
          });
        }
        if (!ocrWillRun && !body.lineItems) {
          throw new UnprocessableEntityException({
            error: 'line_items_required',
            detail:
              'Document extraction is unavailable, so a photographed sheet must be accompanied by the hours read from it.',
          });
        }
      }

      const useManualTranscription = body.source === 'paper_ocr' && !ocrWillRun && !!body.lineItems;
      // A transcribed paper row is 'extracted' immediately: there is no
      // worker step left for it to wait on.
      const initialStatus =
        body.source === 'digital_entry' || useManualTranscription ? 'extracted' : 'queued';

      const [created] = await tx
        .insert(edtr)
        .values({
          tenantId: ctx.tenantId,
          rentalId: body.rentalId,
          equipmentId: body.equipmentId,
          source: body.source,
          reportDate: body.reportDate,
          // The controller's Zod schema (superRefine) already guarantees
          // rawFileUri is present for paper_ocr and lineItems for
          // digital_entry before this service method ever runs.
          rawFileUri: body.source === 'paper_ocr' ? (body.rawFileUri ?? null) : null,
          // Records HOW the hours were obtained, permanently and queryably,
          // so a transcription can never later be mistaken for a real
          // extraction. digital_entry keeps a null payload exactly as
          // before.
          ocrPayload:
            useManualTranscription && body.lineItems
              ? buildManualTranscriptionPayload({
                  hoursActive: body.lineItems.hoursActive,
                  hoursIdle: body.lineItems.hoursIdle,
                  analyzedAt: new Date().toISOString(),
                })
              : null,
          status: initialStatus,
        })
        .returning();
      if (!created) throw new Error('edtr insert returned no row');

      let finalStatus: string = created.status;
      // Reconcile whenever line items are present, whatever the source --
      // previously this ran only for digital_entry, which is why a paper
      // row could never enter the gate.
      if (body.lineItems) {
        await tx.insert(edtrLineItems).values({
          tenantId: ctx.tenantId,
          edtrId: created.id,
          hoursActive: String(body.lineItems.hoursActive),
          hoursIdle: String(body.lineItems.hoursIdle),
        });
        await reconcileEdtr(tx, ctx.tenantId, created.id);
        // reconcileEdtr writes the authoritative status; re-read rather than
        // re-deriving it here so the two can never drift apart.
        const [refetched] = await tx.select().from(edtr).where(eq(edtr.id, created.id)).limit(1);
        finalStatus = refetched?.status ?? created.status;
      }

      await this.events.emit(ctx, 'edtr_uploaded', { edtr_id: created.id, source: body.source });

      return { id: created.id, status: finalStatus, source: body.source, pollUrl: `/api/v1/edtr/${created.id}` };
    });
  }

  // GET /api/v1/edtr?... (S8 review queue, cr-arkilaunch-f9-read-surface.md).
  // A timekeeper sees only EDTRs tied to a site they are assigned to (the
  // same US-02 AC2 boundary capture() already enforces, extended to reads
  // -- QAD-T29); staff see the whole tenant. `review` rows sort first
  // (single-source-pending and tolerance-exceeded discrepancies both land
  // there, packages/db/src/reconciliation.ts:87,112) so the queue surfaces
  // actionable items before already-settled ones.
  async list(ctx: RequestContext, query: EdtrListQuery) {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (query.status) conditions.push(eq(edtr.status, query.status));
      if (query.rentalId) conditions.push(eq(edtr.rentalId, query.rentalId));
      if (query.equipmentId) conditions.push(eq(edtr.equipmentId, query.equipmentId));
      if (query.from) conditions.push(gte(edtr.reportDate, query.from));
      if (query.to) conditions.push(lte(edtr.reportDate, query.to));

      if (ctx.role === 'timekeeper') {
        const assignments = await tx
          .select({ projectSiteId: timekeeperSiteAssignments.projectSiteId })
          .from(timekeeperSiteAssignments)
          .where(eq(timekeeperSiteAssignments.userId, ctx.userId));
        const siteIds = assignments.map((row) => row.projectSiteId);
        if (siteIds.length === 0) return { items: [], total: 0 };

        const assignedRentals = await tx
          .select({ id: rentals.id })
          .from(rentals)
          .where(inArray(rentals.projectSiteId, siteIds));
        const rentalIds = assignedRentals.map((row) => row.id);
        if (rentalIds.length === 0) return { items: [], total: 0 };
        conditions.push(inArray(edtr.rentalId, rentalIds));
      }

      const priority = sql`CASE WHEN ${edtr.status} = 'review' THEN 0 ELSE 1 END`;
      const rows = await tx
        .select()
        .from(edtr)
        .where(and(...conditions))
        .orderBy(priority, desc(edtr.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const total = (await tx.select().from(edtr).where(and(...conditions))).length;

      const reconRows = rows.length
        ? await tx
            .select()
            .from(edtrReconciliations)
            .where(inArray(edtrReconciliations.edtrId, rows.map((row) => row.id)))
        : [];
      const reconByEdtrId = new Map(reconRows.map((row) => [row.edtrId, row]));

      return {
        items: rows.map((row) => {
          const recon = reconByEdtrId.get(row.id);
          return {
            id: row.id,
            rentalId: row.rentalId,
            equipmentId: row.equipmentId,
            source: row.source,
            reportDate: row.reportDate,
            status: row.status,
            reconciliation: recon
              ? {
                  id: recon.id,
                  status: recon.status,
                  deltaHours: recon.deltaHours !== null ? Number(recon.deltaHours) : null,
                  tolerance: Number(recon.tolerance),
                }
              : null,
          };
        }),
        total,
      };
    });
  }

  // GET /api/v1/edtr/:id (poll target, RFC-2 §3).
  async get(ctx: RequestContext, id: string): Promise<EdtrDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(edtr).where(eq(edtr.id, id)).limit(1);
      if (!row) throw new NotFoundException({ error: 'edtr_not_found' });

      const lineItems = await tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, id));
      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.edtrId, id))
        .limit(1);

      const payload = row.ocrPayload as OcrPayload | null;
      const fields =
        payload?.fields.map((field) => ({
          name: field.name,
          value: field.value,
          confidence: field.confidence,
          belowGate: field.confidence < CONFIDENCE_GATE,
          boundingRegion: field.bounding_region ?? null,
        })) ?? [];

      return {
        id: row.id,
        status: row.status,
        source: row.source as 'paper_ocr' | 'digital_entry',
        lineItems: lineItems.map((item) => ({
          hoursActive: Number(item.hoursActive),
          // Number(null) is 0, which would render "0.0 idle" for a paper
          // sheet that never recorded idle hours at all -- the same
          // fabricated reading migration 0017 exists to stop. Stays null.
          hoursIdle: item.hoursIdle === null ? null : Number(item.hoursIdle),
        })),
        fields,
        // Provenance, so the client cannot render a human transcription's
        // confidence of 1.00 as though a model were certain.
        extraction: payload
          ? {
              modelId: payload.model_id,
              analyzedAt: payload.analyzed_at,
              isManualTranscription: isManualTranscription(payload),
            }
          : null,
        reconciliation: reconciliation
          ? {
              id: reconciliation.id,
              status: reconciliation.status,
              counterpartEdtrId: reconciliation.counterpartEdtrId,
              deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
              tolerance: Number(reconciliation.tolerance),
              reason: (reconciliation.adjustments as { reason?: ReconciliationReason } | null)?.reason ?? null,
            }
          : null,
      };
    });
  }

  // POST /api/v1/edtr/:id/approve (RFC-2 §3): the ONLY path that deducts.
  // Asserts matched-or-human-resolved before opening the deduction write;
  // there is no override edge (AGENTS.md "Never": deduct without a passing
  // reconciliation or explicit human approval).
  // Approve addressed by the reconciliation itself. The review queue knows a
  // reconciliation id, not the EDTR that owns it, so requiring the caller to
  // supply both made the gate reachable only from the capture screen that had
  // just created the pair. Resolution happens here; every gate, lock and
  // deduction rule still runs in approve() below, unchanged.
  async approveByReconciliation(ctx: RequestContext, reconciliationId: string, body: EdtrApproveRequest) {
    const edtrId = await withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select({ edtrId: edtrReconciliations.edtrId })
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.id, reconciliationId))
        .limit(1);
      if (!row) throw new NotFoundException({ error: 'reconciliation_not_found' });
      return row.edtrId;
    });
    return this.approve(ctx, edtrId, { ...body, reconciliationId });
  }

  async approve(ctx: RequestContext, edtrId: string, body: EdtrApproveRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
      if (!record) throw new NotFoundException({ error: 'edtr_not_found' });

      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.id, body.reconciliationId))
        .limit(1);
      if (!reconciliation) {
        // RLS scopes the select above, so another tenant's reconciliation is
        // indistinguishable from a nonexistent one here -- which is the
        // intended isolation behaviour, not a gap.
        throw new NotFoundException({ error: 'reconciliation_not_found' });
      }
      // A reconciliation belongs to exactly one EDTR. Reporting a mismatch as
      // 'not found' told a reviewer the row did not exist when it did, which
      // is the wrong thing to act on; name the real problem and hand back the
      // EDTR that actually owns it so the caller can retry correctly.
      if (reconciliation.edtrId !== edtrId) {
        throw new UnprocessableEntityException({
          error: 'reconciliation_belongs_to_other_edtr',
          reconciliationId: reconciliation.id,
          edtrId: reconciliation.edtrId,
        });
      }

      // A pair is approved ONCE, not once per side. reconcileEdtr()
      // (packages/db/src/reconciliation.ts) writes two reconciliation rows
      // per matched pair, one keyed on each EDTR id, so the same day's work
      // can be approved from either side -- but approve() now flips BOTH
      // rows to 'approved' together (below), so a second call against
      // either side always finds status 'approved' here and is rejected
      // before any money moves (cr-arkilaunch-edtr-double-approve.md).
      if (reconciliation.status === 'approved') {
        throw new ConflictException({ error: 'already_approved', reconciliationId: reconciliation.id });
      }

      if (reconciliation.status !== 'matched' && reconciliation.status !== 'discrepancy') {
        throw new UnprocessableEntityException({ error: 'not_approvable', status: reconciliation.status });
      }
      // A discrepancy can only proceed if a human has resolved it by
      // supplying corrected adjustments in this same call; otherwise the
      // gate holds and nothing is deducted (US-01 AC2, QAD-T26).
      if (reconciliation.status === 'discrepancy' && !body.adjustments) {
        // deltaHours is one scalar for a multi-dimension check, so the
        // per-dimension breakdown rides along: without it a reviewer is
        // told the pair diverged but not whether the disagreement is in
        // billable active hours or only in idle classification, which is
        // the whole basis for deciding what to approve.
        const stored = reconciliation.adjustments as
          | { reason?: ReconciliationReason; deltas?: HourDeltas }
          | null;
        throw new ConflictException({
          error: 'reconciliation_discrepancy',
          // `reason` matters as much as the numbers: an 'unreadable' block
          // carries null deltas because one log recorded no hours at all,
          // and without the reason that reads as a missing value rather
          // than as the reason the pair was stopped.
          reason: stored?.reason ?? null,
          deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
          deltas: stored?.deltas ?? null,
          tolerance: Number(reconciliation.tolerance),
        });
      }

      // Lock this reconciliation row and its counterpart before any money
      // moves. A plain read-then-check above would still race a
      // concurrent double-approve on the SAME side (QAD-T26: "direct API,
      // replayed, or race"); `for('update')` closes that by serializing
      // concurrent calls on this row and the counterpart's row.
      const [lockedRecon] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.id, reconciliation.id))
        .for('update');
      if (lockedRecon?.status === 'approved') {
        throw new ConflictException({ error: 'already_approved', reconciliationId: reconciliation.id });
      }
      if (reconciliation.counterpartEdtrId) {
        const [counterpartRecon] = await tx
          .select()
          .from(edtrReconciliations)
          .where(eq(edtrReconciliations.edtrId, reconciliation.counterpartEdtrId))
          .for('update');
        if (counterpartRecon?.status === 'approved') {
          throw new ConflictException({
            error: 'already_approved',
            reconciliationId: reconciliation.id,
            approvedReconciliationId: counterpartRecon.id,
          });
        }
      }

      const lineItems = await tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, edtrId));
      const recordedActive = lineItems.reduce((sum, item) => sum + Number(item.hoursActive), 0);
      const billableHoursActive = body.adjustments?.hoursActive ?? recordedActive;

      // Deduction amount: billable (revenue-generating) active hours priced
      // at the rate card that was in force on the EDTR's report_date. The
      // RFC specifies the gate, not the money formula in this level of
      // detail; this applies the same effectiveness rule the quotation
      // engine does (RFC-3 / QAD-T44/T48,
      // apps/api/src/quotes/pricing-engine.service.ts) rather than inventing
      // a second pricing path.
      //
      // Three things this must not do. It must not take whichever card sorts
      // newest regardless of effectiveness -- that lets a superseded or
      // future-dated card price a money-moving deduction, which is the
      // defect QAD-T44/T48 exists to prevent on the quote side. It must not
      // price against `now`: the work happened on report_date, so a rate
      // change made afterwards cannot retroactively reprice it. And it must
      // not mix rate types -- `rate_type` is free text ('hourly', 'daily')
      // and pricing.service.ts's overlap guard is scoped by it, so an hourly
      // and a daily card for one equipment type are *designed* to be
      // effective at once. Multiplying a daily rate by hours is a 24x
      // mispricing, and without this filter which one wins is unspecified.
      //
      // `report_date` is a bare date and `effective_from`/`effective_to` are
      // timestamptz, so both sides are compared as Manila calendar dates.
      // Casting the date to a timestamp instead would anchor it to midnight
      // UTC, which is 08:00 in Manila: a card created during business hours
      // on the report date would be read as not yet effective, and where it
      // was the only card the approval would fail closed on a state that is
      // actually correct. The zone is fixed because the product is
      // PH-only (docs/clr-arkilaunch.md gap E1); a tenant-level zone would
      // belong on `tenants` first.
      const [equipmentRow] = await tx.select().from(equipment).where(eq(equipment.id, record.equipmentId)).limit(1);
      const [rateCard] = equipmentRow
        ? await tx
            .select()
            .from(rateCards)
            .where(
              and(
                eq(rateCards.tenantId, ctx.tenantId),
                eq(rateCards.equipmentTypeId, equipmentRow.equipmentTypeId),
                eq(rateCards.rateType, 'hourly'),
                sql`(${rateCards.effectiveFrom} at time zone ${TENANT_TIME_ZONE})::date <= ${record.reportDate}::date`,
                sql`(${rateCards.effectiveTo} is null or (${rateCards.effectiveTo} at time zone ${TENANT_TIME_ZONE})::date > ${record.reportDate}::date)`,
              ),
            )
            .orderBy(desc(rateCards.effectiveFrom))
            .limit(1)
        : [];
      // Adding the effectiveness filter above introduces a case that could
      // not happen before it: cards exist for this equipment type, but none
      // covers report_date. Falling through to a 0 rate there would post a
      // zero deduction that reads as a real, approved one and silently
      // under-bills the tenant, so it fails closed instead. A type with no
      // rate cards at all keeps the previous behaviour -- there is nothing
      // misconfigured to report, and no deduction to price.
      if (equipmentRow && !rateCard) {
        const [anyCard] = await tx
          .select({ id: rateCards.id })
          .from(rateCards)
          .where(
            and(
              eq(rateCards.tenantId, ctx.tenantId),
              eq(rateCards.equipmentTypeId, equipmentRow.equipmentTypeId),
              eq(rateCards.rateType, 'hourly'),
            ),
          )
          .limit(1);
        if (anyCard) {
          throw new UnprocessableEntityException({
            error: 'rate_card_not_effective',
            equipmentTypeId: equipmentRow.equipmentTypeId,
            reportDate: record.reportDate,
            message:
              'No rate card was in force on this EDTR report date (all are superseded or not yet active); fix the rate card before approving.',
          });
        }
      }

      const hourlyRate = rateCard ? Number(rateCard.rateValue) : 0;
      const deductedAmount = round2HalfUp(billableHoursActive * hourlyRate);

      // Deposit ledger: resolves the rental's configured deposit_required
      // (rentals -> quotations -> rental_contracts) and every prior
      // deposit_deduction invoice, shared with billing.service.ts's ledger
      // read via resolveDepositLedger() so the two never disagree
      // (cr-arkilaunch-f9-read-surface.md fix: balance now measures against
      // the actual deposit cap instead of only ever growing).
      const ledger = await resolveDepositLedger(tx, record.rentalId);
      let balanceBefore: number;
      let balanceAfter: number;
      if (ledger.depositRequired !== null) {
        balanceBefore = round2HalfUp(ledger.depositRequired - ledger.totalDeducted);
        balanceAfter = round2HalfUp(balanceBefore - deductedAmount);
        if (balanceAfter < 0) {
          throw new ConflictException({
            error: 'deposit_exhausted',
            balanceBefore,
            attemptedDeduction: deductedAmount,
          });
        }
      } else {
        // No quotation/rental_contracts chain for this rental (e.g. a
        // booking created directly via bookings.service.ts) -- there is no
        // configured cap to gate against, so this reports the running
        // total deducted instead of a balance and never blocks the
        // approve. Documented simplification, same category as
        // payments.service.ts's DEFAULT_DEPOSIT_PHP fallback.
        balanceBefore = round2HalfUp(ledger.totalDeducted);
        balanceAfter = round2HalfUp(balanceBefore + deductedAmount);
      }

      const [invoice] = await tx
        .insert(invoices)
        .values({
          tenantId: ctx.tenantId,
          rentalId: record.rentalId,
          invoiceType: 'deposit_deduction',
          amount: String(deductedAmount),
          status: 'issued',
          dueDate: new Date(),
        })
        .returning();
      if (!invoice) throw new Error('invoice insert returned no row');

      await tx.insert(invoiceLineItems).values({
        tenantId: ctx.tenantId,
        invoiceId: invoice.id,
        description: `EDTR reconciliation ${reconciliation.id} (sources: ${record.id}, ${reconciliation.counterpartEdtrId ?? 'n/a'})`,
        quantity: String(billableHoursActive),
        unitPrice: String(hourlyRate),
        amount: String(deductedAmount),
      });

      // A pair is approved ONCE, not once per side: both reconciliation
      // rows for this matched pair transition together, so the counterpart
      // is never independently approvable afterward (the lock/check above
      // already proved neither row was 'approved' before this point).
      // Merged, not replaced, following reject()'s precedent below. A bare
      // spread of body.adjustments overwrote the whole column, erasing the
      // machine's own finding (`reason`, and the per-dimension `deltas`
      // behind delta_hours) exactly on the discrepancy-resolution path
      // where "what the gate concluded vs what the human overrode" is the
      // audit question. The keys do not collide, so the merge is lossless.
      const priorAdjustments = (reconciliation.adjustments as Record<string, unknown> | null) ?? {};
      await tx
        .update(edtrReconciliations)
        .set({
          status: 'approved',
          verifiedBy: ctx.userId,
          adjustments: body.adjustments
            ? { ...priorAdjustments, ...body.adjustments }
            : reconciliation.adjustments,
        })
        .where(eq(edtrReconciliations.id, reconciliation.id));
      if (reconciliation.counterpartEdtrId) {
        await tx
          .update(edtrReconciliations)
          .set({ status: 'approved', verifiedBy: ctx.userId })
          .where(eq(edtrReconciliations.edtrId, reconciliation.counterpartEdtrId));
      }

      // PRD-F4 QAD-T4: accrue the unit's cumulative runtime from this
      // approved EDTR. Unconditional now: reaching this point already
      // proves neither side of the pair was previously approved, so this
      // can only run once per matched pair.
      await tx
        .update(equipment)
        .set({ runtimeHours: sql`${equipment.runtimeHours} + ${billableHoursActive}` })
        .where(eq(equipment.id, record.equipmentId));
      await this.events.emit(ctx, 'equipment_runtime_accrued', {
        equipment_id: record.equipmentId,
        hours_accrued: billableHoursActive,
        edtr_id: record.id,
      });

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'DEDUCT',
        entity: 'invoices',
        entityId: invoice.id,
      });

      await this.events.emit(ctx, 'deposit_deduction_committed', {
        invoice_id: invoice.id,
        hours: billableHoursActive,
        gate_passed: true,
      });
      await this.events.emit(ctx, 'billable_hours_reconciled', {
        equipment_id: record.equipmentId,
        billed_hours: billableHoursActive,
        source_logs: [record.id, reconciliation.counterpartEdtrId],
      });

      return {
        reconciliation: {
          id: reconciliation.id,
          status: 'approved',
          deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
          tolerance: Number(reconciliation.tolerance),
        },
        invoiceLine: {
          invoiceId: invoice.id,
          hours: billableHoursActive,
          sourceLogs: [record.id, reconciliation.counterpartEdtrId],
        },
        deposit: { balanceBefore, deducted: deductedAmount, balanceAfter },
      };
    });
  }

  // POST /api/v1/edtr/:id/reject (S8, PRD §5.3 "Review -> Rejected ->
  // Capture"). Deducts nothing -- a rejected reconciliation never reaches
  // approve()'s gate. Scoped to only this edtr's own reconciliation row
  // (edtr_reconciliations.edtr_id is unique per row); unlike approve(),
  // this deliberately does not force the counterpart's row to reject in
  // lockstep -- rejecting doesn't move money, so there is no double-spend
  // invariant to protect the way approve()'s pair-lock protects one.
  async reject(ctx: RequestContext, edtrId: string, body: EdtrRejectRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
      if (!record) throw new NotFoundException({ error: 'edtr_not_found' });

      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.edtrId, edtrId))
        .limit(1);
      if (!reconciliation) throw new NotFoundException({ error: 'reconciliation_not_found' });
      if (reconciliation.status === 'approved') {
        throw new ConflictException({ error: 'already_approved', reconciliationId: reconciliation.id });
      }
      if (reconciliation.status === 'rejected') {
        throw new ConflictException({ error: 'already_rejected', reconciliationId: reconciliation.id });
      }

      const priorAdjustments = (reconciliation.adjustments as Record<string, unknown> | null) ?? {};
      await tx
        .update(edtrReconciliations)
        .set({
          status: 'rejected',
          verifiedBy: ctx.userId,
          adjustments: { ...priorAdjustments, rejectionReason: body.reason ?? null },
        })
        .where(eq(edtrReconciliations.id, reconciliation.id));

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'edtr_reconciliations',
        entityId: reconciliation.id,
      });
      await this.events.emit(ctx, 'edtr_reconciliation_rejected', {
        edtr_id: edtrId,
        reconciliation_id: reconciliation.id,
      });

      return { id: reconciliation.id, status: 'rejected' };
    });
  }
}
