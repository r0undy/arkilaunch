import { z } from 'zod';

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

// Pure gate evaluation (RFC-2 §3 state machine), no DB/IO -- unit-testable
// in isolation from the worker's claim/lock loop and the DB orchestration
// in packages/db/src/reconciliation.ts.
export function evaluateGate(
  minConfidenceA: number,
  minConfidenceB: number,
  deltaHours: number,
  tolerance: number,
): GateResult {
  if (minConfidenceA < CONFIDENCE_GATE || minConfidenceB < CONFIDENCE_GATE) {
    return { matched: false, reason: 'low_confidence' };
  }
  if (deltaHours > tolerance) {
    return { matched: false, reason: 'tolerance_exceeded' };
  }
  return { matched: true, reason: 'auto_accept' };
}

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
    lineItems: z
      .object({
        hoursActive: z.number().finite().min(0),
        hoursIdle: z.number().finite().min(0),
      })
      .optional(),
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

const AdjustmentsSchema = z.object({
  hoursActive: z.number().finite().min(0),
  hoursIdle: z.number().finite().min(0),
});

export const EdtrApproveRequestSchema = z.object({
  reconciliationId: z.string().uuid(),
  adjustments: AdjustmentsSchema.nullable().optional(),
});
export type EdtrApproveRequest = z.infer<typeof EdtrApproveRequestSchema>;

// GET /api/v1/edtr?... (S8 review queue, cr-arkilaunch-f9-read-surface.md).
export const EdtrListQuerySchema = z.object({
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
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type EdtrListQuery = z.infer<typeof EdtrListQuerySchema>;

// POST /api/v1/edtr/:id/reject (S8, PRD §5.3 "Review -> Rejected ->
// Capture"). Deducts nothing; a separate action from approve().
export const EdtrRejectRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type EdtrRejectRequest = z.infer<typeof EdtrRejectRequestSchema>;
