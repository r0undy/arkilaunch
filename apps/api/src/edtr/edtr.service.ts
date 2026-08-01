import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
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
  timekeeperSiteAssignments,
  withTenantTx,
} from '@arkilaunch/db';
import {
  CONFIDENCE_GATE,
  type EdtrApproveRequest,
  type EdtrCaptureRequest,
  type OcrPayload,
  type ReconciliationReason,
  type RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { round2HalfUp } from '../quotes/pricing-engine.service.js';

@Injectable()
export class EdtrService {
  constructor(private readonly events: EventsService) {}

  // POST /api/v1/edtr (RFC-2 §3). Enforces the US-02 AC2 site-scope check
  // for timekeepers before anything is written.
  async capture(ctx: RequestContext, body: EdtrCaptureRequest) {
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

      const initialStatus = body.source === 'digital_entry' ? 'extracted' : 'queued';
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
          status: initialStatus,
        })
        .returning();
      if (!created) throw new Error('edtr insert returned no row');

      let finalStatus: string = created.status;
      if (body.source === 'digital_entry' && body.lineItems) {
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

      return { id: created.id, status: finalStatus, source: created.source, pollUrl: `/api/v1/edtr/${created.id}` };
    });
  }

  // GET /api/v1/edtr/:id (poll target, RFC-2 §3).
  async get(ctx: RequestContext, id: string) {
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
        source: row.source,
        lineItems: lineItems.map((item) => ({
          hoursActive: Number(item.hoursActive),
          hoursIdle: Number(item.hoursIdle),
        })),
        fields,
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
  async approve(ctx: RequestContext, edtrId: string, body: EdtrApproveRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
      if (!record) throw new NotFoundException({ error: 'edtr_not_found' });

      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.id, body.reconciliationId))
        .limit(1);
      if (!reconciliation || reconciliation.edtrId !== edtrId) {
        throw new NotFoundException({ error: 'reconciliation_not_found' });
      }

      if (reconciliation.status !== 'matched' && reconciliation.status !== 'discrepancy') {
        throw new UnprocessableEntityException({ error: 'not_approvable', status: reconciliation.status });
      }
      // A discrepancy can only proceed if a human has resolved it by
      // supplying corrected adjustments in this same call; otherwise the
      // gate holds and nothing is deducted (US-01 AC2, QAD-T26).
      if (reconciliation.status === 'discrepancy' && !body.adjustments) {
        throw new ConflictException({
          error: 'reconciliation_discrepancy',
          deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
          tolerance: Number(reconciliation.tolerance),
        });
      }

      const lineItems = await tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, edtrId));
      const recordedActive = lineItems.reduce((sum, item) => sum + Number(item.hoursActive), 0);
      const billableHoursActive = body.adjustments?.hoursActive ?? recordedActive;

      // Deduction amount: billable (revenue-generating) active hours priced
      // at the equipment type's currently-effective hourly rate card. The
      // RFC specifies the gate, not the money formula in this level of
      // detail; this reuses the same rate-card lookup the quotation engine
      // uses (RFC-3) rather than inventing a second pricing path.
      const [equipmentRow] = await tx.select().from(equipment).where(eq(equipment.id, record.equipmentId)).limit(1);
      const [rateCard] = equipmentRow
        ? await tx
            .select()
            .from(rateCards)
            .where(and(eq(rateCards.tenantId, ctx.tenantId), eq(rateCards.equipmentTypeId, equipmentRow.equipmentTypeId)))
            .orderBy(desc(rateCards.effectiveFrom))
            .limit(1)
        : [];
      const hourlyRate = rateCard ? Number(rateCard.rateValue) : 0;
      const deductedAmount = round2HalfUp(billableHoursActive * hourlyRate);

      // Running deduction total for this rental (rental_contracts/deposit
      // funding is PRD-F2, not yet built; this is a documented
      // simplification -- the security property under test is the GATE,
      // not the exact deposit-ledger arithmetic).
      const priorDeductions = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, record.rentalId), eq(invoices.invoiceType, 'deposit_deduction')));
      const balanceBefore = round2HalfUp(
        priorDeductions.reduce((sum, invoice) => sum + Number(invoice.amount), 0),
      );
      const balanceAfter = round2HalfUp(balanceBefore + deductedAmount);

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

      await tx
        .update(edtrReconciliations)
        .set({
          status: 'approved',
          verifiedBy: ctx.userId,
          adjustments: body.adjustments ? { ...body.adjustments } : reconciliation.adjustments,
        })
        .where(eq(edtrReconciliations.id, reconciliation.id));

      // PRD-F4 QAD-T4: accrue the unit's cumulative runtime from this
      // approved EDTR. Guarded against the double-approve case:
      // reconcileEdtr() deliberately writes two reconciliation rows per
      // matched pair, one keyed on each EDTR id (packages/db/src/reconciliation.ts
      // "this is redundant but not unsafe" note) -- so the same day's work
      // can be approved from EITHER side. If the counterpart side is
      // already approved, this call is the second of the pair; skip the
      // accrual so runtime_hours (and the F4 utilization report / PM cron
      // that read it) never double-counts one day's work.
      let counterpartAlreadyApproved = false;
      if (reconciliation.counterpartEdtrId) {
        const [counterpartRecon] = await tx
          .select()
          .from(edtrReconciliations)
          .where(eq(edtrReconciliations.edtrId, reconciliation.counterpartEdtrId))
          .limit(1);
        counterpartAlreadyApproved = counterpartRecon?.status === 'approved';
      }
      if (!counterpartAlreadyApproved) {
        await tx
          .update(equipment)
          .set({ runtimeHours: sql`${equipment.runtimeHours} + ${billableHoursActive}` })
          .where(eq(equipment.id, record.equipmentId));
        await this.events.emit(ctx, 'equipment_runtime_accrued', {
          equipment_id: record.equipmentId,
          hours_accrued: billableHoursActive,
          edtr_id: record.id,
        });
      }

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
}
