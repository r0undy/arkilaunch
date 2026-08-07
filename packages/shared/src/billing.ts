import { z } from 'zod';

// PRD-F2/F3 read surface backing S9 Billing & Deposit Ledger
// (cr-arkilaunch-f9-read-surface.md). Read-only: every write to
// invoices/payments already happens in edtr.service.ts / payments.service.ts.

// GET /invoices?... query is validated the same as any other external
// input (AGENTS.md "Always: validate external input at the boundary with
// Zod"). invoiceType/status stay plain strings (not an enum) because
// invoices.status has no DB check constraint and payments.service.ts
// already writes a 'disputed' value beyond the billing.ts schema comment's
// informal list -- an enum here would reject a legitimate existing value.
export const InvoiceListQuerySchema = z.object({
  rentalId: z.string().uuid().optional(),
  invoiceType: z.string().min(1).max(50).optional(),
  status: z.string().min(1).max(50).optional(),
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
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

// --- Response schemas (egress allowlists). ---

export const InvoiceSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  rentalId: z.string().uuid(),
  invoiceType: z.string(),
  amount: z.number(),
  status: z.string(),
  dueDate: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type InvoiceSummaryResponse = z.infer<typeof InvoiceSummaryResponseSchema>;

export const InvoiceListResponseSchema = z.object({
  items: z.array(InvoiceSummaryResponseSchema),
  total: z.number().int(),
});
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;

export const InvoiceLineItemResponseSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  amount: z.number(),
});
export type InvoiceLineItemResponse = z.infer<typeof InvoiceLineItemResponseSchema>;

export const EdtrDeductionEvidenceSchema = z.object({
  reconciliationId: z.string().uuid(),
  sourceEdtrIds: z.array(z.string().uuid()),
  status: z.string(),
  deltaHours: z.number().nullable(),
  tolerance: z.number(),
});
export type EdtrDeductionEvidence = z.infer<typeof EdtrDeductionEvidenceSchema>;

export const AuditTrailEntrySchema = z.object({
  action: z.string(),
  actorId: z.string().uuid(),
  timestamp: z.coerce.date(),
});
export type AuditTrailEntry = z.infer<typeof AuditTrailEntrySchema>;

export const InvoiceDetailResponseSchema = InvoiceSummaryResponseSchema.extend({
  lineItems: z.array(InvoiceLineItemResponseSchema),
  edtrEvidence: EdtrDeductionEvidenceSchema.nullable(),
  auditTrail: z.array(AuditTrailEntrySchema),
});
export type InvoiceDetailResponse = z.infer<typeof InvoiceDetailResponseSchema>;

export const DepositLedgerResponseSchema = z.object({
  rentalId: z.string().uuid(),
  depositRequired: z.number().nullable(),
  totalDeducted: z.number(),
  balanceRemaining: z.number().nullable(),
  deductions: z.array(
    z.object({
      invoiceId: z.string().uuid(),
      amount: z.number(),
      createdAt: z.coerce.date(),
    }),
  ),
});
export type DepositLedgerResponse = z.infer<typeof DepositLedgerResponseSchema>;
