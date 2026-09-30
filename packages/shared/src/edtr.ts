import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';
import { round2HalfUp } from './pricing.js';

// RFC-2: OCR output is data, never a command; validate before any use (AI-02).
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

// Seed default only; the live tolerance is per-row on edtr_reconciliations.tolerance.
export const CONFIDENCE_GATE = 0.9;
export const DEFAULT_TOLERANCE_HOURS = 0.25;

// Not a real model: marks hours a human read off the paper sheet.
export const MANUAL_TRANSCRIPTION_MODEL_ID = 'manual_transcription';

export function isManualTranscription(payload: { model_id?: string } | null | undefined): boolean {
  return payload?.model_id === MANUAL_TRANSCRIPTION_MODEL_ID;
}

// Confidence 1 is correct: no model means nothing for the 0.90 gate to gate;
// the double-entry tolerance check remains the control (RFC-2).
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

// Only the two hour fields exist on edtr_line_items, so only those are compared.
// total is separate: abs per-dimension deltas lose the sign that decides cancel vs accumulate.
export interface HourDeltas {
  active: number;
  // null when either log lacks idle hours; skipped, never 0 -- a 0 would assert agreement.
  idle: number | null;
  total: number | null;
}

// Both the gate test and the persisted delta_hours, so the two can never drift.
export function worstDelta(deltas: HourDeltas): number {
  return Math.max(...comparableDeltas(deltas));
}

function comparableDeltas(deltas: HourDeltas): number[] {
  return [deltas.active, deltas.idle, deltas.total].filter((d): d is number => d !== null);
}

// RFC-2 gate. Every dimension AND the summed total must pass: summing alone let
// 8h active/0h idle auto-accept against 0h/8h, yet the deduction prices hours_active.
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
  weatherAm: z.string().max(4).nullable().optional(),
  weatherPm: z.string().max(4).nullable().optional(),
});
export type EdtrLineItemsInput = z.infer<typeof EdtrLineItemsInputSchema>;

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

// No rawFileUri: the controller derives it from the uploaded file; a client can never supply it.
export const EdtrCaptureFieldsSchema = z
  .object({
    source: z.enum(['paper_ocr', 'digital_entry']),
    rentalId: z.string().uuid(),
    equipmentId: z.string().uuid(),
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Multipart carries every field as a string, so accept the JSON encoding.
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

export const EdtrRejectRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type EdtrRejectRequest = z.infer<typeof EdtrRejectRequestSchema>;

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

// manual_transcription confidence 1.00 must render as a human transcription, never "OCR 100%".
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
  extraction: EdtrExtractionResponseSchema.nullable(),
});
export type EdtrDetailResponse = z.infer<typeof EdtrDetailResponseSchema>;

// Downtime causes are null when not recorded (pre-v3 rows), which is NOT zero.
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
  running: number;
  billable: number;
  nonBillable: number;
  idle: number;
  breakdown: number;
  weather: number;
  otherDowntime: number;
  // Only a categorised (v3) row proves idle was the customer's choice, so billable.
  categorised: boolean;
  meterDelta: number | null;
}

// The one billable definition (deduction, meter, portal, dashboards). Pre-v3 idle may
// include weather/breakdown time, so it is billed only on a categorised row.
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

// Each flag routes the day to a human; none blocks capture (the signed paper is the evidence).
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

export interface ReportSpan {
  from: string;
  to: string | null;
}

export const EDTR_TIME_ZONE = 'Asia/Manila';

export function manilaDate(at: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EDTR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

// Monday of the Manila week that contains `at`.
export function manilaWeekStart(at: Date | string): string {
  const day = new Date(`${manilaDate(at)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reportSpan(start: Date | string, end: Date | string | null): ReportSpan {
  return { from: manilaDate(start), to: end === null ? null : manilaDate(end) };
}

export function isInReportSpan(reportDate: string, span: ReportSpan): boolean {
  return reportDate >= span.from && (span.to === null || reportDate <= span.to);
}

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

export const FIELD_LOG_DAY_STATUSES = ['missing', 'pending', 'needs_correction', 'approved', 'rejected'] as const;
export type FieldLogDayStatus = (typeof FIELD_LOG_DAY_STATUSES)[number];
