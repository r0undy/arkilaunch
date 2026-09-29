import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';
import { round2HalfUp } from './pricing.js';

// RFC-2 §3: the ocr_payload JSONB contract, written verbatim by the
// edtr-ocr-worker and validated with Zod before use (AI-02: insecure output
// handling -- extracted text is data, never a command, and never flows into
// a query unvalidated).
export const OcrFieldSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string()]),
  value_type: z.enum(['number', 'string']),
  confidence: z.number().min(0).max(1),
  bounding_region: z
    .object({ page: z.number().int(), polygon: z.array(z.number()) })
    .nullable()
    .optional(),
});
export type OcrField = z.infer<typeof OcrFieldSchema>;

export const OcrPayloadSchema = z.object({
  model_id: z.string(),
  api_version: z.string(),
  analyzed_at: z.string(),
  fields: z.array(OcrFieldSchema),
  min_field_confidence: z.number().min(0).max(1),
  pages: z.number().int().min(1),
});
export type OcrPayload = z.infer<typeof OcrPayloadSchema>;

// RFC-2 §2/§3 state-machine constants. Tenant tolerance is stored per-row
// on edtr_reconciliations.tolerance (this is only the seed default for a
// newly created reconciliation row).
export const CONFIDENCE_GATE = 0.9;
export const DEFAULT_TOLERANCE_HOURS = 0.25;

// The model_id recorded when a human read the paper sheet instead of a
// model (cr-arkilaunch-pilot-honesty.md §2.1). Not a real model, and
// deliberately named so no query, report, or reviewer can mistake it for
// one.
export const MANUAL_TRANSCRIPTION_MODEL_ID = 'manual_transcription';

export function isManualTranscription(payload: { model_id?: string } | null | undefined): boolean {
  return payload?.model_id === MANUAL_TRANSCRIPTION_MODEL_ID;
}

// Builds the ocr_payload for a human-transcribed paper EDTR.
//
// min_field_confidence is 1, and that is correct rather than a fudge:
// packages/db/src/reconciliation.ts already returns 1 for digital_entry on
// the stated grounds that it "has no OCR step". A human transcription has
// no OCR step either. The 0.90 gate exists to gate MODEL output; where
// there is no model there is nothing for it to gate, and the double-entry
// tolerance check against the counterpart log remains the real control --
// which is the whole point of RFC-2's two-independent-logs design.
export function buildManualTranscriptionPayload(input: {
  hoursActive: number;
  hoursIdle: number;
  analyzedAt: string;
}): OcrPayload {
  return OcrPayloadSchema.parse({
    model_id: MANUAL_TRANSCRIPTION_MODEL_ID,
    api_version: 'n/a',
    analyzed_at: input.analyzedAt,
    fields: [
      { name: 'hours_active', value: input.hoursActive, value_type: 'number', confidence: 1 },
      { name: 'hours_idle', value: input.hoursIdle, value_type: 'number', confidence: 1 },
    ],
    min_field_confidence: 1,
    pages: 1,
  });
}

export type ReconciliationReason =
  | 'auto_accept'
  | 'low_confidence'
  | 'tolerance_exceeded'
  | 'single_source'
  | 'unreadable'
  | null;

export interface GateResult {
  matched: boolean;
  reason: ReconciliationReason;
}

// The divergence between two independent logs of the same equipment-day.
// RFC-2 §2 names five dimensions (start time, end time, active hours, idle
// hours, breakdown status); only the two hour fields exist on
// edtr_line_items today, so only those two are compared here.
//
// `total` is carried separately rather than derived from `active` + `idle`
// because it is NOT derivable from them: the per-dimension deltas are
// absolute values, so they have already discarded the sign that decides
// whether two errors accumulate or cancel.
export interface HourDeltas {
  active: number;
  // null when either log did not record idle hours at all. The real Almara
  // paper form has no idle column (docs/cr-arkilaunch-edtr-real-form.md),
  // so this is the normal case for a paper/digital pair, not an edge case.
  //
  // An absent dimension is skipped, not defaulted to 0. A 0 delta would be
  // an assertion that the two logs AGREE about idle hours, which is a claim
  // nobody made -- it would pull a real disagreement elsewhere through the
  // gate on the strength of evidence that does not exist.
  idle: number | null;
  // Null whenever idle is, since the summed total includes idle hours and
  // so cannot be compared either.
  total: number | null;
}

// The single worst divergence across every compared dimension. This is both
// what the gate tests and what gets persisted to
// edtr_reconciliations.delta_hours, deliberately from one definition: if the
// stored number were computed separately it could drift from the number that
// actually decided the gate, and a review screen would then show a delta
// inside tolerance on a row the gate had rejected.
export function worstDelta(deltas: HourDeltas): number {
  return Math.max(...comparableDeltas(deltas));
}

// The dimensions both logs actually recorded. `active` is always present:
// it is the hours the deduction is priced on, and a pair with no active
// reading never reaches the gate (packages/db/src/reconciliation.ts fails
// that closed as 'unreadable').
function comparableDeltas(deltas: HourDeltas): number[] {
  return [deltas.active, deltas.idle, deltas.total].filter((d): d is number => d !== null);
}

// Pure gate evaluation (RFC-2 §3 state machine), no DB/IO -- unit-testable
// in isolation from the worker's claim/lock loop and the DB orchestration
// in packages/db/src/reconciliation.ts.
//
// Every dimension is compared against the tolerance, and ALL of them must
// pass. Comparing only a single summed total was a false-accept hole: a log
// reading 8h active / 0h idle and a counterpart reading 0h active / 8h idle
// both sum to 8, so the pair auto-accepted at delta 0 even though the
// deduction it then approved prices hours_active alone (apps/api/src/edtr/
// edtr.service.ts). An equal-and-opposite misclassification is exactly the
// error two independent logs exist to catch, so it has to fail the gate.
//
// The summed total is still checked alongside the per-dimension deltas, and
// deliberately so: dropping it would make this gate LOOSER than the one it
// replaces for same-signed errors, where active +0.2 and idle +0.2 clear a
// 0.25 tolerance individually but accumulate to 0.4. Checking all three is
// strictly stricter than either rule alone, so no pair that is blocked
// today can start passing.
export function evaluateGate(
  minConfidenceA: number,
  minConfidenceB: number,
  deltas: HourDeltas,
  tolerance: number,
): GateResult {
  if (minConfidenceA < CONFIDENCE_GATE || minConfidenceB < CONFIDENCE_GATE) {
    return { matched: false, reason: 'low_confidence' };
  }
  if (worstDelta(deltas) > tolerance) {
    return { matched: false, reason: 'tolerance_exceeded' };
  }
  return { matched: true, reason: 'auto_accept' };
}

// --- Line items as captured (v3 categories optional so v2 clients work) ---
const hours = z.number().finite().min(0).max(24);
export const EdtrLineItemsInputSchema = z.object({
  hoursActive: hours,
  hoursIdle: hours,
  hoursTotal: hours.nullable().optional(),
  hoursBreakdown: hours.nullable().optional(),
  hoursWeather: hours.nullable().optional(),
  hoursOtherDowntime: hours.nullable().optional(),
  downtimeNote: z.string().trim().max(500).nullable().optional(),
  hourMeterStart: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  hourMeterEnd: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  // Read for the weather cross-check only; the tick itself is attested on
  // the paper, not stored here.
  weatherAm: z.string().max(4).nullable().optional(),
  weatherPm: z.string().max(4).nullable().optional(),
});
export type EdtrLineItemsInput = z.infer<typeof EdtrLineItemsInputSchema>;

// RFC-2 §3 `POST /api/v1/edtr`. File upload / Supabase Storage wiring is a
// follow-up (no real Storage integration exists yet, same stubbed-pending
// state as the Payments/Weather/DI ports); paper_ocr accepts an
// already-uploaded file reference rather than a multipart body for now.
//
// A plain object with a superRefine invariant, not z.discriminatedUnion:
// nestjs-zod's createZodDto cannot extend a discriminated union (its
// generated class base type is a bare union, not an object type). The
// source-conditional requirement (rawFileUri for paper_ocr, lineItems for
// digital_entry) is still enforced, just at validation time instead of the
// type level; callers narrow on `source` after the boundary has already
// guaranteed the invariant holds.
export const EdtrCaptureRequestSchema = z
  .object({
    source: z.enum(['paper_ocr', 'digital_entry']),
    rentalId: z.string().uuid(),
    equipmentId: z.string().uuid(),
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rawFileUri: z.string().min(1).optional(),
    lineItems: EdtrLineItemsInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.source === 'paper_ocr' && !data.rawFileUri) {
      ctx.addIssue({ code: 'custom', message: 'rawFileUri is required for source=paper_ocr', path: ['rawFileUri'] });
    }
    if (data.source === 'digital_entry' && !data.lineItems) {
      ctx.addIssue({ code: 'custom', message: 'lineItems is required for source=digital_entry', path: ['lineItems'] });
    }
  });
export type EdtrCaptureRequest = z.infer<typeof EdtrCaptureRequestSchema>;

// POST /api/v1/edtr wire contract (backend-unblock plan workstream 4): the
// client-facing fields, WITHOUT rawFileUri -- for paper_ocr the image now
// arrives as a multipart `file` field, validated and uploaded to Supabase
// Storage by the controller (see apps/api/src/storage/upload-validation.ts,
// RFC-2 §6), which then derives rawFileUri itself as the storage object
// key. A client can never supply rawFileUri directly. digital_entry has no
// file and is still posted as plain JSON.
export const EdtrCaptureFieldsSchema = z
  .object({
    source: z.enum(['paper_ocr', 'digital_entry']),
    rentalId: z.string().uuid(),
    equipmentId: z.string().uuid(),
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // A paper capture is multipart, and multipart carries every field as a
    // string -- so a nested object could not be expressed at all, and a
    // transcribed paper log (the required shape while OCR is disabled) was
    // rejected as "expected object, received string" no matter how it was
    // sent. Accept the JSON encoding multipart can actually carry. A
    // malformed string fails the object check below rather than throwing.
    lineItems: z
      .preprocess((value) => {
        if (typeof value !== 'string') return value;
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      }, EdtrLineItemsInputSchema)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.source === 'digital_entry' && !data.lineItems) {
      ctx.addIssue({ code: 'custom', message: 'lineItems is required for source=digital_entry', path: ['lineItems'] });
    }
  });
export type EdtrCaptureFields = z.infer<typeof EdtrCaptureFieldsSchema>;

// A reviewer's corrected figures. The v3 categories are optional so a
// v2-era client's { hoursActive, hoursIdle } still validates.
const AdjustmentsSchema = z.object({
  hoursActive: hours,
  hoursIdle: hours,
  hoursBreakdown: hours.nullable().optional(),
  hoursWeather: hours.nullable().optional(),
  hoursOtherDowntime: hours.nullable().optional(),
});

export const EdtrApproveRequestSchema = z.object({
  reconciliationId: z.string().uuid(),
  adjustments: AdjustmentsSchema.nullable().optional(),
});
export type EdtrApproveRequest = z.infer<typeof EdtrApproveRequestSchema>;

// GET /api/v1/edtr?... (S8 review queue, cr-arkilaunch-f9-read-surface.md).
export const EdtrListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['queued', 'extracting', 'extracted', 'review', 'reconciled', 'hard_failed']).optional(),
  rentalId: z.string().uuid().optional(),
  equipmentId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type EdtrListQuery = z.infer<typeof EdtrListQuerySchema>;

// POST /api/v1/edtr/:id/reject (S8, PRD §5.3 "Review -> Rejected ->
// Capture"). Deducts nothing; a separate action from approve().
export const EdtrRejectRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type EdtrRejectRequest = z.infer<typeof EdtrRejectRequestSchema>;

// --- Response schemas (egress allowlists). The one part of the EDTR/KYC/
// Quotes contract that had no shared schema -- the shapes were inline
// object literals in edtr.service.ts, hand-typed on the frontend.

export const EdtrCaptureResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  source: z.enum(['paper_ocr', 'digital_entry']),
  pollUrl: z.string(),
});
export type EdtrCaptureResponse = z.infer<typeof EdtrCaptureResponseSchema>;

export const EdtrFieldResponseSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string()]),
  confidence: z.number().min(0).max(1),
  belowGate: z.boolean(),
  boundingRegion: z.object({ page: z.number().int(), polygon: z.array(z.number()) }).nullable(),
});
export type EdtrFieldResponse = z.infer<typeof EdtrFieldResponseSchema>;

export const EdtrReconciliationResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  counterpartEdtrId: z.string().uuid().nullable(),
  deltaHours: z.number().nullable(),
  tolerance: z.number(),
  reason: z.string().nullable(),
});
export type EdtrReconciliationResponse = z.infer<typeof EdtrReconciliationResponseSchema>;

// Provenance of the hours on this row, so a client can never present a
// human transcription as a model result. A confidence of 1.00 from
// `manual_transcription` must render as "Human transcription", NOT as
// "OCR 100% confident" -- the two mean opposite things to a reviewer.
export const EdtrExtractionResponseSchema = z.object({
  modelId: z.string(),
  analyzedAt: z.string(),
  isManualTranscription: z.boolean(),
});

export const EdtrDetailResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  source: z.enum(['paper_ocr', 'digital_entry']),
  lineItems: z.array(
    z.object({
      hoursActive: z.number(),
      hoursIdle: z.number().nullable(),
      // v3 categories; null on a row recorded before them.
      hoursTotal: z.number().nullable().optional(),
      hoursBreakdown: z.number().nullable().optional(),
      hoursWeather: z.number().nullable().optional(),
      hoursOtherDowntime: z.number().nullable().optional(),
      downtimeNote: z.string().nullable().optional(),
      hourMeterStart: z.number().nullable().optional(),
      hourMeterEnd: z.number().nullable().optional(),
      reviewFlags: z.array(z.string()).optional(),
    }),
  ),
  fields: z.array(EdtrFieldResponseSchema),
  reconciliation: EdtrReconciliationResponseSchema.nullable(),
  // null for digital_entry (no extraction step at all) and for a paper row
  // still queued for the worker.
  extraction: EdtrExtractionResponseSchema.nullable(),
});
export type EdtrDetailResponse = z.infer<typeof EdtrDetailResponseSchema>;

// --- Hour categories (EDTR v3, cr-arkilaunch-edtr-site-hub-approval.md) ---
//
// One day's hours for one unit, as recorded. `running` is hours_active
// (engine working); `idle` is hours_idle (ready on site, the customer chose
// not to use it). The three downtime causes are null when the source did
// not record them at all -- every row captured before EDTR v3 -- which is
// NOT the same as zero, exactly like hours_idle (migration 0017).
export interface DayHours {
  running: number;
  idle: number | null;
  breakdown: number | null;
  weather: number | null;
  otherDowntime: number | null;
  total?: number | null;
  meterStart?: number | null;
  meterEnd?: number | null;
}

export interface ClassifiedHours {
  // Hour meter, PMS and utilization.
  running: number;
  // What the customer is charged for.
  billable: number;
  // Breakdown + weather + other: never billed.
  nonBillable: number;
  idle: number;
  breakdown: number;
  weather: number;
  otherDowntime: number;
  // True when all three downtime causes were recorded (a v3 row). Only then
  // is idle known to be the customer's own choice and so billable.
  categorised: boolean;
  // hour_meter_end - hour_meter_start, the objective check on `running`.
  meterDelta: number | null;
}

// The ONE definition of billable / running / downtime, used by the
// deduction in approve(), the hour meter, the customer portal and every
// dashboard total, so no two screens can disagree about what was billed.
//
// Idle is billed only on a categorised row. On a pre-v3 row the single idle
// figure may include weather or breakdown time (the v2 sheet had one idle
// column with a reason tick), so billing it would charge for downtime; such
// a row is priced on running hours alone, exactly as before this change.
export function classifyHours(h: DayHours): ClassifiedHours {
  const categorised = h.breakdown !== null && h.weather !== null && h.otherDowntime !== null;
  const idle = h.idle ?? 0;
  const breakdown = h.breakdown ?? 0;
  const weather = h.weather ?? 0;
  const otherDowntime = h.otherDowntime ?? 0;
  const meterDelta = h.meterStart != null && h.meterEnd != null ? round2HalfUp(h.meterEnd - h.meterStart) : null;
  return {
    running: round2HalfUp(h.running),
    billable: round2HalfUp(h.running + (categorised ? idle : 0)),
    nonBillable: round2HalfUp(breakdown + weather + otherDowntime),
    idle: round2HalfUp(idle),
    breakdown: round2HalfUp(breakdown),
    weather: round2HalfUp(weather),
    otherDowntime: round2HalfUp(otherDowntime),
    categorised,
    meterDelta,
  };
}

// Capture-time cross-checks. Each one routes the day to a human; none
// blocks the capture, because the signed paper is the evidence and refusing
// it would only push the reading off the record.
export const REVIEW_FLAGS = {
  total_mismatch: 'Total hours do not equal running + idle + downtime',
  weather_downtime_clear_sky: 'Weather downtime recorded on a day ticked clear',
  meter_running_mismatch: 'Hour meter change does not match running hours',
  meter_backwards: 'Hour meter end is below its start',
  meter_gap: 'Hour meter start differs from the last approved reading',
  other_without_note: 'Other downtime has no remark',
  outside_rental: 'Date is outside the rental period',
} as const;
export type ReviewFlag = keyof typeof REVIEW_FLAGS;

export const TOTAL_TOLERANCE_HOURS = 0.25;
export const METER_TOLERANCE_HOURS = 0.5;

export function validateDayEntry(
  h: DayHours & {
    downtimeNote?: string | null;
    weatherAm?: string | null;
    weatherPm?: string | null;
    previousMeterEnd?: number | null;
    outsideSpan?: boolean;
  },
): ReviewFlag[] {
  const c = classifyHours(h);
  const flags: ReviewFlag[] = [];
  if (h.total != null && c.categorised) {
    const parts = c.running + c.idle + c.nonBillable;
    if (Math.abs(h.total - parts) > TOTAL_TOLERANCE_HOURS) flags.push('total_mismatch');
  }
  if (c.weather > 0 && h.weatherAm === 'C' && h.weatherPm === 'C') flags.push('weather_downtime_clear_sky');
  if (c.meterDelta !== null) {
    if (c.meterDelta < 0) flags.push('meter_backwards');
    else if (Math.abs(c.meterDelta - c.running) > METER_TOLERANCE_HOURS) flags.push('meter_running_mismatch');
  }
  if (h.previousMeterEnd != null && h.meterStart != null && Math.abs(h.meterStart - h.previousMeterEnd) > 0.05) {
    flags.push('meter_gap');
  }
  if (c.otherDowntime > 0 && !h.downtimeNote?.trim()) flags.push('other_without_note');
  if (h.outsideSpan) flags.push('outside_rental');
  return flags;
}

// --- Rental span (the dates a field log may carry) ---
//
// A unit's span is its assignment window on the rental, as Asia/Manila
// calendar dates. Read live from equipment_assignments / rentals, so an
// approved extension (which moves the end) widens it with no stored copy.
// `to` null = open-ended.
export interface ReportSpan {
  from: string;
  to: string | null;
}

export const EDTR_TIME_ZONE = 'Asia/Manila';

export function manilaDate(at: Date | string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EDTR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

export function reportSpan(start: Date | string, end: Date | string | null): ReportSpan {
  return { from: manilaDate(start), to: end === null ? null : manilaDate(end) };
}

export function isInReportSpan(reportDate: string, span: ReportSpan): boolean {
  return reportDate >= span.from && (span.to === null || reportDate <= span.to);
}

// Every date of a span up to `until`, capped so an open-ended span cannot
// run away.
export function spanDates(span: ReportSpan, until: string, max = 400): string[] {
  const last = span.to !== null && span.to < until ? span.to : until;
  const out: string[] = [];
  const d = new Date(`${span.from}T00:00:00Z`);
  while (out.length < max) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > last) break;
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function lineItemsToDayHours(li: EdtrLineItemsInput): DayHours {
  return {
    running: li.hoursActive,
    idle: li.hoursIdle,
    breakdown: li.hoursBreakdown ?? null,
    weather: li.hoursWeather ?? null,
    otherDowntime: li.hoursOtherDowntime ?? null,
    total: li.hoursTotal ?? null,
    meterStart: li.hourMeterStart ?? null,
    meterEnd: li.hourMeterEnd ?? null,
  };
}

// POST /api/v1/edtr/:id/review (site hub, edtr:approve). `approve` carries
// the admin's confirmed figures, recorded as the office log (RFC-2's second
// log); the other two need a reason.
export const EdtrReviewRequestSchema = z
  .object({
    decision: z.enum(['approve', 'needs_correction', 'reject']),
    reason: z.string().trim().max(2000).optional(),
    hours: EdtrLineItemsInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === 'approve' && !data.hours) {
      ctx.addIssue({ code: 'custom', message: 'hours are required to approve', path: ['hours'] });
    }
    if (data.decision !== 'approve' && !data.reason) {
      ctx.addIssue({ code: 'custom', message: 'a reason is required', path: ['reason'] });
    }
  });
export type EdtrReviewRequest = z.infer<typeof EdtrReviewRequestSchema>;

// A day's standing in the site hub grid.
export const FIELD_LOG_DAY_STATUSES = ['missing', 'pending', 'needs_correction', 'approved', 'rejected'] as const;
export type FieldLogDayStatus = (typeof FIELD_LOG_DAY_STATUSES)[number];
