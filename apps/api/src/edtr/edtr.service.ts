import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  type Tx,
  auditLogs,
  crossesLowBalance,
  depositAccruals,
  getBillingSettings,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
  equipmentAssignments,
  invoiceLineItems,
  invoices,
  notifications,
  rateCards,
  flagUsedDespiteWarning,
  logWeatherDiscrepancies,
  reconcileEdtr,
  rentals,
  resolveDepositLedger,
  splitDeduction,
  timekeeperSiteAssignments,
  withTenantTx,
} from '@arkilaunch/db';
import {
  round2HalfUp,
  EDTR_TIME_ZONE,
  CONFIDENCE_GATE,
  OCR_CORPUS_FLOOR,
  assertAccuracyGate,
  buildManualTranscriptionPayload,
  classifyHours,
  isInReportSpan,
  isManualTranscription,
  lineItemsToDayHours,
  OFFICE_LOG_NOTE,
  validateDayEntry,
  WEATHER_CODES,
  type ApprovedDayHours,
  type EdtrLineItemsInput,
  type EdtrReviewRequest,
  type EdtrApproveRequest,
  type EdtrCaptureRequest,
  type EdtrCaptureResponse,
  type EdtrDetailResponse,
  type EdtrListQuery,
  type EdtrRejectRequest,
  type HourDeltas,
  type OcrPayload,
  type ReconciliationReason,
  type ReportedWeatherDay,
  type WeatherCode,
  type RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { notifyBookingCustomer, notifyStaff } from '../common/notify-customer.js';
import { num, unitReportSpan } from '../common/field-logs.js';
import { countRows } from '../common/count-rows.js';
import { isOcrPipelineEnabled } from '../ports/document-intelligence.port.js';

// RFC-2 gate: model output may drive a deduction only with an attested accuracy measurement; fails closed without one.
function attestedOcrAccuracyFailure(): string | null {
  const overall = Number(process.env.OCR_MEASURED_ACCURACY);
  const sampleCount = Number(process.env.OCR_MEASURED_SAMPLES);
  if (!Number.isFinite(overall) || !Number.isFinite(sampleCount)) {
    return 'no measured OCR accuracy is attested for this deployment';
  }
  if (sampleCount < OCR_CORPUS_FLOOR.edtr) {
    return `attested corpus of ${sampleCount} samples is below the QAD floor of ${OCR_CORPUS_FLOOR.edtr}`;
  }
  const gate = assertAccuracyGate({
    overall,
    perField: {},
    autoAcceptErrorRate: 0,
    sampleCount,
  });
  return gate.passed ? null : gate.reason;
}


async function lastApprovedMeterEnd(tx: Tx, equipmentId: string, beforeDate: string): Promise<number | null> {
  const [row] = await tx
    .select({ end: edtrLineItems.hourMeterEnd })
    .from(edtrLineItems)
    .innerJoin(edtr, eq(edtr.id, edtrLineItems.edtrId))
    .innerJoin(edtrReconciliations, eq(edtrReconciliations.edtrId, edtr.id))
    .where(
      and(
        eq(edtr.equipmentId, equipmentId),
        eq(edtrReconciliations.status, 'approved'),
        sql`${edtr.reportDate} < ${beforeDate}::date`,
        sql`${edtrLineItems.hourMeterEnd} is not null`,
      ),
    )
    .orderBy(desc(edtr.reportDate))
    .limit(1);
  return row ? num(row.end) : null;
}

const opt = (v: number | null | undefined) => (v == null ? null : String(v));

async function insertLineItem(
  tx: Tx,
  tenantId: string,
  edtrId: string,
  li: EdtrLineItemsInput,
  reviewFlags: string[],
  notes: string | null = null,
) {
  await tx.insert(edtrLineItems).values({
    tenantId,
    edtrId,
    hoursActive: String(li.hoursActive),
    hoursIdle: String(li.hoursIdle),
    hoursTotal: opt(li.hoursTotal),
    hoursBreakdown: opt(li.hoursBreakdown),
    hoursWeather: opt(li.hoursWeather),
    hoursOtherDowntime: opt(li.hoursOtherDowntime),
    downtimeNote: li.downtimeNote?.trim() || null,
    hourMeterStart: opt(li.hourMeterStart),
    hourMeterEnd: opt(li.hourMeterEnd),
    reviewFlags,
    notes,
  });
}

function reportedWeatherDay(li: EdtrLineItemsInput): ReportedWeatherDay {
  const code = (v: string | null | undefined): WeatherCode | null =>
    v && (WEATHER_CODES as readonly string[]).includes(v) ? (v as WeatherCode) : null;
  const weatherHours = li.hoursWeather ?? 0;
  return {
    weatherAm: code(li.weatherAm),
    weatherPm: code(li.weatherPm),
    idleHours: weatherHours > 0 ? weatherHours : (li.hoursIdle ?? null),
    idleReason: weatherHours > 0 ? 'weather' : null,
    hoursActive: li.hoursActive,
  };
}

@Injectable()
export class EdtrService {
  constructor(private readonly events: EventsService) {}

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
          // Own transaction: the throw below rolls back tx, and the denial must stay on the audit trail.
          await withTenantTx(ctx, (t) =>
            t.insert(auditLogs).values({
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: 'CREATE',
              entity: 'edtr_site_scope_denied',
              entityId: rental.id,
            }),
          );
          await this.events.emit(ctx, 'edtr_site_scope_denied', { rental_id: rental.id, project_site_id: rental.projectSiteId });
          throw new ForbiddenException({ error: 'site_not_assigned' });
        }
      }

      const onRental = await tx
        .select({ equipmentId: equipmentAssignments.equipmentId })
        .from(equipmentAssignments)
        .where(and(eq(equipmentAssignments.rentalId, rental.id), ne(equipmentAssignments.status, 'cancelled')));
      if (onRental.length > 0) {
        if (!onRental.some((a) => a.equipmentId === body.equipmentId)) {
          throw new UnprocessableEntityException({ error: 'equipment_not_on_rental' });
        }
      } else {
        // The edtr FK bypasses RLS, so the unit must be visible to this tenant.
        const [unit] = await tx.select({ id: equipment.id }).from(equipment).where(eq(equipment.id, body.equipmentId)).limit(1);
        if (!unit) throw new NotFoundException({ error: 'equipment_not_found' });
      }

      // Hard block for everyone: a day outside the rental cannot be billed.
      const span = await unitReportSpan(tx, rental, body.equipmentId);
      if (!isInReportSpan(body.reportDate, span)) {
        throw new BadRequestException({ error: 'report_date_outside_rental', reportDate: body.reportDate, span });
      }

      // Without OCR, a paper row carries the transcribed hours so it can still pair with the digital log.
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
          rawFileUri: body.source === 'paper_ocr' ? (body.rawFileUri ?? null) : null,
          submittedBy: ctx.userId,
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
      if (body.lineItems) {
        const flags = validateDayEntry({
          ...lineItemsToDayHours(body.lineItems),
          downtimeNote: body.lineItems.downtimeNote ?? null,
          weatherAm: body.lineItems.weatherAm ?? null,
          weatherPm: body.lineItems.weatherPm ?? null,
          previousMeterEnd: await lastApprovedMeterEnd(tx, body.equipmentId, body.reportDate),
        });
        await insertLineItem(tx, ctx.tenantId, created.id, body.lineItems, flags);
        await reconcileEdtr(tx, ctx.tenantId, created.id);
        await flagUsedDespiteWarning(tx, ctx.tenantId, created.id);
        // Weather discrepancies only flag for review; never status, approval or money.
        const weatherFlags = await logWeatherDiscrepancies(
          tx,
          ctx.tenantId,
          created.id,
          body.rentalId,
          body.reportDate,
          reportedWeatherDay(body.lineItems),
        );
        if (weatherFlags.length > 0) {
          const added = [...new Set(weatherFlags.map((f) => `weather_${f.rule}`))];
          await tx
            .update(edtrLineItems)
            .set({ reviewFlags: sql`${edtrLineItems.reviewFlags} || ${JSON.stringify(added)}::jsonb` })
            .where(eq(edtrLineItems.edtrId, created.id));
        }
        // reconcileEdtr owns the status; re-read it rather than re-derive.
        const [refetched] = await tx.select().from(edtr).where(eq(edtr.id, created.id)).limit(1);
        finalStatus = refetched?.status ?? created.status;
      }

      await this.events.emit(ctx, 'edtr_uploaded', { edtr_id: created.id, source: body.source });
      if (ctx.role === 'timekeeper') {
        await notifyStaff(tx, ctx.tenantId, 'edtr_submitted', {
          rental_id: rental.id,
          edtr_id: created.id,
          project_site_id: rental.projectSiteId,
          report_date: body.reportDate,
        });
      }

      return { id: created.id, status: finalStatus, source: body.source, pollUrl: `/api/v1/edtr/${created.id}` };
    });
  }

  // Timekeepers see only EDTRs on their assigned sites.
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
      const total = await countRows(tx, edtr, and(...conditions));

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
          // Stays null: Number(null) is 0, which would fabricate a 0.0 idle reading.
          hoursIdle: item.hoursIdle === null ? null : Number(item.hoursIdle),
          hoursTotal: num(item.hoursTotal),
          hoursBreakdown: num(item.hoursBreakdown),
          hoursWeather: num(item.hoursWeather),
          hoursOtherDowntime: num(item.hoursOtherDowntime),
          downtimeNote: item.downtimeNote,
          hourMeterStart: num(item.hourMeterStart),
          hourMeterEnd: num(item.hourMeterEnd),
          reviewFlags: item.reviewFlags,
        })),
        fields,
        // Provenance: a human transcription's 1.00 confidence must not read as model certainty.
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

  // RLS, not a client-supplied key, decides visibility; another tenant's id reads as 404.
  async rawFileKey(ctx: RequestContext, id: string): Promise<string> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select({ rawFileUri: edtr.rawFileUri })
        .from(edtr)
        .where(eq(edtr.id, id))
        .limit(1);
      if (!row) throw new NotFoundException({ error: 'edtr_not_found' });
      if (!row.rawFileUri) throw new NotFoundException({ error: 'edtr_scan_not_found' });
      return row.rawFileUri;
    });
  }

  // Resolves the owning EDTR, then runs every approve() gate unchanged.
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
    return withTenantTx(ctx, (tx) => this.approveInTx(tx, ctx, edtrId, body));
  }

  // RFC-2: the ONLY path that deducts, with no override edge. Runs in the caller's tx so a
  // refused gate also rolls back the site hub's office log.
  private async approveInTx(tx: Tx, ctx: RequestContext, edtrId: string, body: EdtrApproveRequest) {
    const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
    if (!record) throw new NotFoundException({ error: 'edtr_not_found' });

    // Locked first, so every gate below runs on data a concurrent reject or approve cannot change.
    const [reconciliation] = await tx
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.id, body.reconciliationId))
      .limit(1)
      .for('update');
    if (!reconciliation) {
      // RLS: another tenant's reconciliation reads as not found, by design.
      throw new NotFoundException({ error: 'reconciliation_not_found' });
    }
    if (reconciliation.edtrId !== edtrId) {
      throw new UnprocessableEntityException({
        error: 'reconciliation_belongs_to_other_edtr',
        reconciliationId: reconciliation.id,
        edtrId: reconciliation.edtrId,
      });
    }

    // A pair is approved once: both rows flip to 'approved' together, so a retry on either side stops here.
    if (reconciliation.status === 'approved') {
      throw new ConflictException({ error: 'already_approved', reconciliationId: reconciliation.id });
    }

    if (reconciliation.status !== 'matched' && reconciliation.status !== 'discrepancy') {
      throw new UnprocessableEntityException({ error: 'not_approvable', status: reconciliation.status });
    }
    // RFC-2 gate: a discrepancy proceeds only with human-supplied adjustments in this call.
    if (reconciliation.status === 'discrepancy' && !body.adjustments) {
      const stored = reconciliation.adjustments as
        | { reason?: ReconciliationReason; deltas?: HourDeltas }
        | null;
      throw new ConflictException({
        error: 'reconciliation_discrepancy',
        reason: stored?.reason ?? null,
        deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
        deltas: stored?.deltas ?? null,
        tolerance: Number(reconciliation.tolerance),
      });
    }

    // The counterpart is locked too, so the pair is approved once across both sides.
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
      // RFC-2: a pair whose other side was rejected is not a passing reconciliation.
      if (counterpartRecon?.status === 'rejected') {
        throw new ConflictException({
          error: 'counterpart_rejected',
          reconciliationId: reconciliation.id,
          rejectedReconciliationId: counterpartRecon.id,
        });
      }
    }

    const [rental] = await tx
      .select({ id: rentals.id, startDate: rentals.startDate, endDate: rentals.endDate })
      .from(rentals)
      .where(eq(rentals.id, record.rentalId))
      .limit(1);
    if (!rental || !isInReportSpan(record.reportDate, await unitReportSpan(tx, rental, record.equipmentId))) {
      throw new UnprocessableEntityException({ error: 'report_date_outside_rental', reportDate: record.reportDate });
    }

    // RFC-2 gate: model-sourced hours on either side of the pair need attested OCR accuracy.
    const pairPayloads: unknown[] = [record.ocrPayload];
    if (reconciliation.counterpartEdtrId) {
      const [counterpartRow] = await tx
        .select({ ocrPayload: edtr.ocrPayload })
        .from(edtr)
        .where(eq(edtr.id, reconciliation.counterpartEdtrId))
        .limit(1);
      if (counterpartRow) pairPayloads.push(counterpartRow.ocrPayload);
    }
    const modelSourced = pairPayloads.some(
      (payload) => payload !== null && !isManualTranscription(payload as { model_id?: string }),
    );
    if (modelSourced) {
      const failure = attestedOcrAccuracyFailure();
      if (failure) {
        throw new ConflictException({ error: 'ocr_accuracy_gate_unmet', reason: failure });
      }
    }

    const lineItems = await tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, edtrId));
    // classifyHours is the one billing rule: downtime never billed, idle only on a categorised (v3) row.
    const stored = lineItems[0];
    const adj = body.adjustments;
    const {
      running: runningHours,
      billable: billableHoursActive,
      idle,
      breakdown,
      weather,
      otherDowntime,
    } = classifyHours({
      running: adj?.hoursActive ?? lineItems.reduce((sum, item) => sum + Number(item.hoursActive), 0),
      idle: adj ? adj.hoursIdle : stored ? num(stored.hoursIdle) : null,
      breakdown: adj?.hoursBreakdown !== undefined ? adj.hoursBreakdown : stored ? num(stored.hoursBreakdown) : null,
      weather: adj?.hoursWeather !== undefined ? adj.hoursWeather : stored ? num(stored.hoursWeather) : null,
      otherDowntime:
        adj?.hoursOtherDowntime !== undefined ? adj.hoursOtherDowntime : stored ? num(stored.hoursOtherDowntime) : null,
    });
    const billed: ApprovedDayHours = { running: runningHours, billable: billableHoursActive, idle, breakdown, weather, otherDowntime };

    // Overrides rewrite the line items too; the original extraction stays in ocr_payload.
    if (body.adjustments) {
      await tx
        .update(edtrLineItems)
        .set({
          hoursActive: String(body.adjustments.hoursActive),
          hoursIdle: String(body.adjustments.hoursIdle),
          ...(body.adjustments.hoursBreakdown !== undefined ? { hoursBreakdown: opt(body.adjustments.hoursBreakdown) } : {}),
          ...(body.adjustments.hoursWeather !== undefined ? { hoursWeather: opt(body.adjustments.hoursWeather) } : {}),
          ...(body.adjustments.hoursOtherDowntime !== undefined
            ? { hoursOtherDowntime: opt(body.adjustments.hoursOtherDowntime) }
            : {}),
        })
        .where(eq(edtrLineItems.edtrId, edtrId));
    }

    // Priced at the hourly card in force on report_date (Manila calendar dates), never at `now`.
    const [equipmentRow] = await tx.select().from(equipment).where(eq(equipment.id, record.equipmentId)).limit(1);
    const [rateCard] = equipmentRow
      ? await tx
          .select()
          .from(rateCards)
          .where(
            and(
              eq(rateCards.tenantId, ctx.tenantId),
              eq(rateCards.equipmentTypeId, equipmentRow.equipmentTypeId),
              // A unit's own card overrides its type's.
              or(eq(rateCards.equipmentId, record.equipmentId), isNull(rateCards.equipmentId)),
              eq(rateCards.rateType, 'hourly'),
              sql`(${rateCards.effectiveFrom} at time zone ${EDTR_TIME_ZONE})::date <= ${record.reportDate}::date`,
              sql`(${rateCards.effectiveTo} is null or (${rateCards.effectiveTo} at time zone ${EDTR_TIME_ZONE})::date > ${record.reportDate}::date)`,
            ),
          )
          .orderBy(sql`${rateCards.equipmentId} is null`, desc(rateCards.effectiveFrom))
          .limit(1)
      : [];
    // RFC-2 fail closed: a type with any card (even a retired non-hourly one) but no in-force hourly card must never post a 0 deduction.
    if (equipmentRow && !rateCard) {
      const [anyCard] = await tx
        .select({ id: rateCards.id })
        .from(rateCards)
        .where(
          and(
            eq(rateCards.tenantId, ctx.tenantId),
            eq(rateCards.equipmentTypeId, equipmentRow.equipmentTypeId),
          ),
        )
        .limit(1);
      if (anyCard) {
        throw new UnprocessableEntityException({
          error: 'rate_card_not_effective',
          equipmentTypeId: equipmentRow.equipmentTypeId,
          reportDate: record.reportDate,
          message:
            'No hourly rate card was in force on this EDTR report date; fix the rate card before approving.',
        });
      }
    }

    const hourlyRate = rateCard ? Number(rateCard.rateValue) : 0;
    const deductedAmount = round2HalfUp(billableHoursActive * hourlyRate);

    // Past the deposit balance, the remainder becomes an unbilled accrual invoiced later.
    // Lock the rental so concurrent approvals can't both read the same balance and over-draw.
    const [lockedRental] = await tx
      .select({ id: rentals.id, code: rentals.code })
      .from(rentals)
      .where(eq(rentals.id, record.rentalId))
      .for('update');
    const bookingCode = lockedRental?.code ?? null;
    // RFC-2 fail closed: a deduction draws only on a paid deposit or booking invoice.
    const [depositPaid] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.rentalId, record.rentalId),
          inArray(invoices.invoiceType, ['deposit', 'booking']),
          eq(invoices.status, 'paid'),
        ),
      )
      .limit(1);
    if (!depositPaid) throw new ConflictException({ error: 'deposit_not_paid' });
    const ledger = await resolveDepositLedger(tx, record.rentalId, ctx.tenantId);
    const balanceBefore = round2HalfUp(Math.max(0, ledger.depositRequired - ledger.totalDeducted));
    const split = splitDeduction(balanceBefore, deductedAmount);
    const balanceAfter = split.balanceAfter;
    // Hours split in the same ratio, so hours-used adds up across both.
    const deductedHours =
      deductedAmount > 0 ? round2HalfUp((billableHoursActive * split.deducted) / deductedAmount) : billableHoursActive;

    let invoice: { id: string } | null = null;
    if (split.deducted > 0 || split.accrued === 0) {
      const [inserted] = await tx
        .insert(invoices)
        .values({
          tenantId: ctx.tenantId,
          rentalId: record.rentalId,
          invoiceType: 'deposit_deduction',
          amount: String(split.deducted),
          status: 'issued',
          dueDate: new Date(),
        })
        .returning();
      if (!inserted) throw new Error('invoice insert returned no row');
      invoice = inserted;

      await tx.insert(invoiceLineItems).values({
        tenantId: ctx.tenantId,
        invoiceId: inserted.id,
        // The evidence link to the reconciliation; the description is for humans only.
        reconciliationId: reconciliation.id,
        description: [
          bookingCode,
          equipmentRow?.model ?? 'Equipment',
          record.reportDate,
          `${runningHours.toFixed(1)} h running${billed.idle > 0 && billableHoursActive > runningHours ? ` + ${billed.idle.toFixed(1)} h idle` : ''}`,
        ]
          .filter(Boolean)
          .join(' · '),
        quantity: String(deductedHours),
        unitPrice: String(hourlyRate),
        amount: String(split.deducted),
      });
    }
    if (split.accrued > 0) {
      await tx.insert(depositAccruals).values({
        tenantId: ctx.tenantId,
        rentalId: record.rentalId,
        reconciliationId: reconciliation.id,
        hours: String(round2HalfUp(billableHoursActive - deductedHours)),
        unitPrice: String(hourlyRate),
        amount: String(split.accrued),
      });
    }

    const { lowBalancePct } = await getBillingSettings(tx, ctx.tenantId);
    if (crossesLowBalance(ledger.depositRequired, balanceBefore, balanceAfter, lowBalancePct)) {
      const payload = { rental_id: record.rentalId, balance_php: balanceAfter, deposit_php: ledger.depositRequired };
      await notifyBookingCustomer(tx, ctx.tenantId, record.rentalId, 'deposit_low', payload);
      await notifyStaff(tx, ctx.tenantId, 'deposit_low', payload);
    }

    // Both pair rows flip together. Adjustments merge, never replace, so the gate's own finding
    // survives; `billed` is what every read model totals.
    const priorAdjustments = (reconciliation.adjustments as Record<string, unknown> | null) ?? {};
    await tx
      .update(edtrReconciliations)
      .set({
        status: 'approved',
        verifiedBy: ctx.userId,
        adjustments: { ...priorAdjustments, ...(body.adjustments ?? {}), billed },
      })
      .where(eq(edtrReconciliations.id, reconciliation.id));
    if (reconciliation.counterpartEdtrId) {
      await tx
        .update(edtrReconciliations)
        .set({ status: 'approved', verifiedBy: ctx.userId })
        .where(eq(edtrReconciliations.edtrId, reconciliation.counterpartEdtrId));
    }

    // Runs once per pair: the gates above proved neither side was approved.
    await tx
      .update(equipment)
      // Running hours only: idle and downtime don't wear the engine (feeds the PMS notice).
      .set({ runtimeHours: sql`${equipment.runtimeHours} + ${runningHours}` })
      .where(eq(equipment.id, record.equipmentId));
    await this.events.emit(ctx, 'equipment_runtime_accrued', {
      equipment_id: record.equipmentId,
      hours_accrued: runningHours,
      edtr_id: record.id,
    });

    const dayPayload = {
      rental_id: record.rentalId,
      edtr_id: record.id,
      equipment_id: record.equipmentId,
      report_date: record.reportDate,
    };
    await notifyBookingCustomer(tx, ctx.tenantId, record.rentalId, 'daily_log_approved', dayPayload);
    await this.notifySubmitters(tx, ctx, [record.id, reconciliation.counterpartEdtrId], 'edtr_approved', dayPayload);

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'DEDUCT',
      entity: invoice ? 'invoices' : 'edtr_reconciliations',
      entityId: invoice?.id ?? reconciliation.id,
    });

    await this.events.emit(ctx, 'deposit_deduction_committed', {
      invoice_id: invoice?.id ?? null,
      accrued_php: split.accrued,
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
        invoiceId: invoice?.id ?? null,
        hours: billableHoursActive,
        sourceLogs: [record.id, reconciliation.counterpartEdtrId],
      },
      deposit: { balanceBefore, deducted: split.deducted, accrued: split.accrued, balanceAfter },
    };
  }

  // Never notifies the reviewer themself.
  private async notifySubmitters(
    tx: Tx,
    ctx: RequestContext,
    edtrIds: (string | null)[],
    notificationType: string,
    payload: Record<string, unknown>,
  ) {
    const ids = edtrIds.filter((id): id is string => !!id);
    if (ids.length === 0) return;
    const rows = await tx.select({ submittedBy: edtr.submittedBy }).from(edtr).where(inArray(edtr.id, ids));
    const userIds = [...new Set(rows.map((r) => r.submittedBy).filter((u): u is string => !!u && u !== ctx.userId))];
    if (userIds.length === 0) return;
    await tx
      .insert(notifications)
      .values(userIds.map((userId) => ({ tenantId: ctx.tenantId, userId, notificationType, payload })));
  }

  // approve: the admin's figures become the independent office log, then every approveInTx() gate runs;
  // a disagreement is resolved by this explicit human approval, never auto-accepted.
  async review(ctx: RequestContext, edtrId: string, body: EdtrReviewRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
      if (!record) throw new NotFoundException({ error: 'edtr_not_found' });
      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.edtrId, edtrId))
        .limit(1)
        .for('update');
      if (!reconciliation) {
        // A paper row still queued for the OCR worker has no hours yet.
        throw new UnprocessableEntityException({ error: 'not_reviewable', status: record.status });
      }
      if (reconciliation.status === 'approved') {
        throw new ConflictException({ error: 'already_approved', reconciliationId: reconciliation.id });
      }
      if (reconciliation.status === 'rejected') {
        throw new ConflictException({ error: 'already_rejected', reconciliationId: reconciliation.id });
      }
      const dayPayload = {
        rental_id: record.rentalId,
        edtr_id: record.id,
        equipment_id: record.equipmentId,
        report_date: record.reportDate,
      };

      if (body.decision !== 'approve') {
        const priorAdjustments = (reconciliation.adjustments as Record<string, unknown> | null) ?? {};
        await tx
          .update(edtrReconciliations)
          .set({
            status: 'rejected',
            verifiedBy: ctx.userId,
            adjustments: {
              ...priorAdjustments,
              rejectionReason: body.reason ?? null,
              correction_requested: body.decision === 'needs_correction',
            },
          })
          .where(eq(edtrReconciliations.id, reconciliation.id));
        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'UPDATE',
          entity: body.decision === 'needs_correction' ? 'edtr_correction_requested' : 'edtr_reconciliations',
          entityId: reconciliation.id,
          reason: body.reason ?? null,
        });
        await this.events.emit(ctx, 'edtr_reconciliation_rejected', {
          edtr_id: record.id,
          reconciliation_id: reconciliation.id,
          correction_requested: body.decision === 'needs_correction',
        });
        await this.notifySubmitters(
          tx,
          ctx,
          [record.id],
          body.decision === 'needs_correction' ? 'edtr_needs_correction' : 'edtr_rejected',
          { ...dayPayload, reason: body.reason ?? null },
        );
        return { id: record.id, status: body.decision === 'needs_correction' ? 'needs_correction' : 'rejected' };
      }

      const hours = body.hours!;
      if (!reconciliation.counterpartEdtrId) {
        const officeSource = record.source === 'paper_ocr' ? 'digital_entry' : 'paper_ocr';
        const [office] = await tx
          .insert(edtr)
          .values({
            tenantId: ctx.tenantId,
            rentalId: record.rentalId,
            equipmentId: record.equipmentId,
            source: officeSource,
            reportDate: record.reportDate,
            submittedBy: ctx.userId,
            // The admin reading the signed sheet: a human transcription, never model output.
            ocrPayload:
              officeSource === 'paper_ocr'
                ? buildManualTranscriptionPayload({
                    hoursActive: hours.hoursActive,
                    hoursIdle: hours.hoursIdle,
                    analyzedAt: new Date().toISOString(),
                  })
                : null,
            status: 'extracted',
          })
          .returning();
        if (!office) throw new Error('office log insert returned no row');
        await insertLineItem(tx, ctx.tenantId, office.id, hours, [], OFFICE_LOG_NOTE);
        await reconcileEdtr(tx, ctx.tenantId, office.id, { counterpartId: record.id });
        const paired = await reconcileEdtr(tx, ctx.tenantId, record.id, { counterpartId: office.id });
        if (paired.counterpartEdtrId !== office.id) {
          throw new ConflictException({ error: 'office_log_not_paired' });
        }
      }

      const result = await this.approveInTx(tx, ctx, record.id, {
        reconciliationId: reconciliation.id,
        adjustments: {
          hoursActive: hours.hoursActive,
          hoursIdle: hours.hoursIdle,
          hoursBreakdown: hours.hoursBreakdown ?? null,
          hoursWeather: hours.hoursWeather ?? null,
          hoursOtherDowntime: hours.hoursOtherDowntime ?? null,
        },
      });
      await tx
        .update(edtrLineItems)
        .set({
          hoursTotal: hours.hoursTotal == null ? null : String(hours.hoursTotal),
          downtimeNote: hours.downtimeNote?.trim() || null,
          hourMeterStart: hours.hourMeterStart == null ? null : String(hours.hourMeterStart),
          hourMeterEnd: hours.hourMeterEnd == null ? null : String(hours.hourMeterEnd),
        })
        .where(eq(edtrLineItems.edtrId, record.id));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'edtr_approved_in_site_hub',
        entityId: reconciliation.id,
      });
      return result;
    });
  }

  // Deducts nothing, so only this side's row is rejected (no pair lock needed).
  async reject(ctx: RequestContext, edtrId: string, body: EdtrRejectRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
      if (!record) throw new NotFoundException({ error: 'edtr_not_found' });

      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.edtrId, edtrId))
        .limit(1)
        .for('update');
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
