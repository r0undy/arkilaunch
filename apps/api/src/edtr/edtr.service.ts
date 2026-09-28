import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  crossesLowBalance,
  depositAccruals,
  getBillingSettings,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
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
import { unitReportSpan } from '../common/field-logs.js';
import { isOcrPipelineEnabled } from '../ports/document-intelligence.port.js';
import { round2HalfUp } from '../quotes/pricing-engine.service.js';

// Calendar day that a bare `date` column means. Fixed rather than
// per-tenant because the product is PH-only (docs/clr-arkilaunch.md gap E1,
// and the Azure region is southeastasia for the same reason); if tenants
// ever span zones, this belongs on `tenants` and not in a constant here.
const TENANT_TIME_ZONE = 'Asia/Manila';

// QAD-T39 at runtime.
//
// The threshold, the corpus floor and the gate function have existed in
// packages/shared/src/ocr-accuracy.ts since the money-path pass, but the
// only things that ever called them were a spec and the fixture puller:
// nothing on the path that actually moves money consulted the gate, so
// ENABLE_OCR_PIPELINE=true on its own was enough to route model output
// into a deposit deduction whether or not the golden set had ever been
// measured, let alone met (audit-ocr-money-path.md #8).
//
// The measurement itself is produced offline by the accuracy harness
// against the labeled golden set, so the runtime cannot recompute it. It
// reads the attested result instead, and fails closed when there is
// none -- which is the correct state today: the EDTR model is untrained
// and the corpus does not exist, so the pilot's only approvable path is
// human transcription, exactly as RFC-2 and the pilot-honesty record say.
// Reuses assertAccuracyGate rather than re-implementing the comparison,
// so the empty-corpus rule stays in one place.
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

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
const num = (v: string | null) => (v === null ? null : Number(v));

// The hour meter a new reading should start from: the latest APPROVED end
// reading for this unit before the report date.
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

// One line item from captured hours. The v3 categories are written only
// when sent, so a v2 client's row keeps NULL (not recorded) there.
async function insertLineItem(
  tx: Tx,
  tenantId: string,
  edtrId: string,
  li: EdtrLineItemsInput,
  reviewFlags: string[],
  notes: string | null = null,
) {
  const opt = (v: number | null | undefined) => (v === undefined || v === null ? null : String(v));
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

// A captured entry's weather in the shape compareReportedWeather reads:
// the AM/PM ticks when they are valid codes, and weather hours as idle
// hours put down to weather.
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

      // A field log may only carry a date inside the unit's live rental
      // span (its assignment window, else the rental's dates). Hard-blocked
      // for everyone: a day outside the rental cannot be billed, so there is
      // nothing a reviewer could approve it into
      // (cr-arkilaunch-edtr-site-hub-approval.md).
      const span = await unitReportSpan(tx, rental, body.equipmentId);
      if (!isInReportSpan(body.reportDate, span)) {
        throw new BadRequestException({ error: 'report_date_outside_rental', reportDate: body.reportDate, span });
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
      // Reconcile whenever line items are present, whatever the source --
      // previously this ran only for digital_entry, which is why a paper
      // row could never enter the gate.
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
        // Hours on a machine warned to stop work that day: incident log only.
        await flagUsedDespiteWarning(tx, ctx.tenantId, created.id);
        // The entry's weather against the site's recorded readings
        // (docs/cr-arkilaunch-weather-monitoring.md). A discrepancy is a
        // review flag plus an incident-log row -- it never changes the
        // status, the approval or money (RFC-2).
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
        // reconcileEdtr writes the authoritative status; re-read rather than
        // re-deriving it here so the two can never drift apart.
        const [refetched] = await tx.select().from(edtr).where(eq(edtr.id, created.id)).limit(1);
        finalStatus = refetched?.status ?? created.status;
      }

      await this.events.emit(ctx, 'edtr_uploaded', { edtr_id: created.id, source: body.source });
      // The office sees a timekeeper's submission waiting in its site hub.
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

  // The storage key of the scanned page, for the review overlay. Read
  // inside withTenantTx so RLS -- not a client-supplied key -- decides
  // which row is visible; another tenant's id is simply not there, and
  // reads as 404 rather than 403 (RFC-1: the tenant comes from the
  // verified JWT, never from the request).
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
    return withTenantTx(ctx, (tx) => this.approveInTx(tx, ctx, edtrId, body));
  }

  // The approval itself, inside the caller's transaction, so the site hub's
  // review() can write the office log and approve in ONE transaction: a gate
  // that refuses (deposit_not_paid, rate_card_not_effective, ...) rolls the
  // office log back with it.
  private async approveInTx(tx: Tx, ctx: RequestContext, edtrId: string, body: EdtrApproveRequest) {
    {
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

      // A deduction carried by MODEL output may only proceed if the
      // model's accuracy has actually been measured and met (QAD-T39).
      //
      // Both sides, not just the row being approved: approve() is called
      // on whichever side the reviewer opened, and for the pilot pairing
      // that is usually the digital_entry row, which has no payload at
      // all. Checking only `record` would let a model-extracted paper
      // counterpart carry the deduction untested. Human transcription is
      // unaffected -- there is no model output for the gate to be about.
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
      // What is billed and what runs the hour meter, from ONE rule
      // (classifyHours, packages/shared/src/edtr.ts). Downtime is never
      // billed; idle is billed only on a categorised (v3) row. A pre-v3 row
      // therefore prices on running hours alone, exactly as before, and an
      // adjustment that does not name the categories keeps the row's own.
      const stored = lineItems[0];
      const adj = body.adjustments;
      const classified = classifyHours({
        running: adj?.hoursActive ?? lineItems.reduce((sum, item) => sum + Number(item.hoursActive), 0),
        idle: adj ? adj.hoursIdle : stored ? num(stored.hoursIdle) : null,
        breakdown: adj?.hoursBreakdown !== undefined ? adj.hoursBreakdown : stored ? num(stored.hoursBreakdown) : null,
        weather: adj?.hoursWeather !== undefined ? adj.hoursWeather : stored ? num(stored.hoursWeather) : null,
        otherDowntime:
          adj?.hoursOtherDowntime !== undefined ? adj.hoursOtherDowntime : stored ? num(stored.hoursOtherDowntime) : null,
      });
      const billableHoursActive = classified.billable;
      const runningHours = classified.running;
      const billed: ApprovedDayHours = {
        running: classified.running,
        billable: classified.billable,
        idle: classified.idle,
        breakdown: classified.breakdown,
        weather: classified.weather,
        otherDowntime: classified.otherDowntime,
      };

      // A reviewer's override has to reach the evidence, not just the
      // price. AdjustmentsSchema requires hoursIdle and approve() used to
      // read only hoursActive, so correcting 8.0/1.0 to 7.0/2.0 produced
      // the right deduction and left the edtr_line_items row still saying
      // 8.0/1.0 -- the row's own evidence permanently contradicting the
      // figure it was approved at, with idle reporting and the audit trail
      // reading the stale numbers (audit-ocr-money-path.md #10).
      //
      // The machine's original extraction is not lost: it stays in
      // edtr.ocr_payload, which is what the accuracy harness measures
      // against. This corrects the human-facing record of hours worked.
      if (body.adjustments) {
        await tx
          .update(edtrLineItems)
          .set({
            hoursActive: String(body.adjustments.hoursActive),
            hoursIdle: String(body.adjustments.hoursIdle),
            ...(body.adjustments.hoursBreakdown !== undefined
              ? { hoursBreakdown: body.adjustments.hoursBreakdown === null ? null : String(body.adjustments.hoursBreakdown) }
              : {}),
            ...(body.adjustments.hoursWeather !== undefined
              ? { hoursWeather: body.adjustments.hoursWeather === null ? null : String(body.adjustments.hoursWeather) }
              : {}),
            ...(body.adjustments.hoursOtherDowntime !== undefined
              ? {
                  hoursOtherDowntime:
                    body.adjustments.hoursOtherDowntime === null ? null : String(body.adjustments.hoursOtherDowntime),
                }
              : {}),
          })
          .where(eq(edtrLineItems.edtrId, edtrId));
      }

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
                // A unit's own card overrides its type's (0038).
                or(eq(rateCards.equipmentId, record.equipmentId), isNull(rateCards.equipmentId)),
                eq(rateCards.rateType, 'hourly'),
                sql`(${rateCards.effectiveFrom} at time zone ${TENANT_TIME_ZONE})::date <= ${record.reportDate}::date`,
                sql`(${rateCards.effectiveTo} is null or (${rateCards.effectiveTo} at time zone ${TENANT_TIME_ZONE})::date > ${record.reportDate}::date)`,
              ),
            )
            .orderBy(sql`${rateCards.equipmentId} is null`, desc(rateCards.effectiveFrom))
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

      // Deposit ledger: the rental's contract deposit_required, else the
      // tenant's minimum deposit, less every prior deposit_deduction --
      // shared with billing.service.ts via resolveDepositLedger() so the
      // two never disagree (audit-ocr-money-path.md #5).
      //
      // Rollover: a charge past the balance no longer fails with
      // deposit_exhausted. The part the deposit covers is deducted; the
      // rest becomes an unbilled accrual that jobs/src/weekly-billing.ts
      // invoices weekly. Reaching this line already required a reconciled
      // or human-approved pair (RFC-2), so both halves carry that gate.
      // Lock the rental so two pairs approved at once can't both read the
      // same balance and over-draw the deposit.
      const [lockedRental] = await tx
        .select({ id: rentals.id, code: rentals.code })
        .from(rentals)
        .where(eq(rentals.id, record.rentalId))
        .for('update');
      const bookingCode = lockedRental?.code ?? null;
      // A deduction draws on money actually held: the rental's deposit (or
      // booking invoice, which carries the deposit line) must be paid --
      // online via PayMongo or a staff-recorded cash receipt. The ledger
      // alone only knows what was *required* (cr-arkilaunch-paymongo-linked-accounts.md).
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
          // The evidence link is this column, not the sentence below it. The
          // description stays because it is what a human reads on an
          // invoice, but it is no longer load-bearing: it was the only tie
          // between a deduction and the reconciliation justifying it, parsed
          // back out with a regex (audit-db-tenant-isolation.md #3).
          reconciliationId: reconciliation.id,
          // What a person reads: the booking code, the machine, the day and
          // the hours split (cr-arkilaunch-uniform-booking-codes.md).
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
      // `billed` records the figures this approval charged, so every read
      // model (site hub, booking rollup, portal) totals what was billed
      // rather than re-deriving it.
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

      // PRD-F4 QAD-T4: accrue the unit's cumulative runtime from this
      // approved EDTR. Unconditional now: reaching this point already
      // proves neither side of the pair was previously approved, so this
      // can only run once per matched pair.
      await tx
        .update(equipment)
        // RUNNING hours only: idle and downtime do not wear the engine, and
        // the maintenance job (jobs/src/maintenance-notify.ts) raises the
        // PMS notice from this figure.
        .set({ runtimeHours: sql`${equipment.runtimeHours} + ${runningHours}` })
        .where(eq(equipment.id, record.equipmentId));
      await this.events.emit(ctx, 'equipment_runtime_accrued', {
        equipment_id: record.equipmentId,
        hours_accrued: runningHours,
        edtr_id: record.id,
      });

      // The customer's daily log is now visible on their booking page, and
      // whoever submitted the day hears it went through.
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
  }

  // Tells the timekeeper(s) who recorded these logs, never the reviewer
  // themself (the office log is theirs).
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

  // POST /api/v1/edtr/:id/review (site hub, cr-arkilaunch-edtr-site-hub-approval.md).
  //
  // approve: the admin's confirmed figures become the OFFICE LOG -- RFC-2's
  // second, independent log -- written on the other source and pinned to
  // this submission, then the pair reconciles through the unchanged gate
  // and approveInTx() runs every money-path check it always has. The
  // admin's figures ride in as adjustments, so a disagreement between the
  // two logs is resolved by this explicit human approval (verified_by set),
  // never auto-accepted. edtr_recon_matched_needs_counterpart_chk still
  // holds: there is always a counterpart.
  //
  // needs_correction / reject: the reconciliation closes as rejected with
  // the reason, the timekeeper is told, and a corrected resubmission is a
  // new row for the same day.
  async review(ctx: RequestContext, edtrId: string, body: EdtrReviewRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [record] = await tx.select().from(edtr).where(eq(edtr.id, edtrId)).limit(1);
      if (!record) throw new NotFoundException({ error: 'edtr_not_found' });
      const [reconciliation] = await tx
        .select()
        .from(edtrReconciliations)
        .where(eq(edtrReconciliations.edtrId, edtrId))
        .limit(1);
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
            // A paper-side office log is the admin reading the signed sheet:
            // recorded as a human transcription, never as model output.
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
      // The submission's own line item carries the confirmed meter
      // readings and remark too (the adjustment covers the hours).
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
