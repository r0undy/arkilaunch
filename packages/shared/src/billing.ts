import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

export const InvoiceListQuerySchema = PaginationQuerySchema.extend({
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
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

export const InvoiceSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  rentalId: z.string().uuid().nullable(),
  truckRequestId: z.string().uuid().nullable(),
  bookingCode: z.string().nullable(),
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
  billTo: z
    .object({ companyName: z.string(), tin: z.string().nullable(), billingAddress: z.string().nullable() })
    .nullable(),
  edtrEvidence: EdtrDeductionEvidenceSchema.nullable(),
  auditTrail: z.array(AuditTrailEntrySchema),
});
export type InvoiceDetailResponse = z.infer<typeof InvoiceDetailResponseSchema>;

export const DepositLedgerResponseSchema = z.object({
  rentalId: z.string().uuid(),
  depositRequired: z.number().nullable(),
  totalDeducted: z.number(),
  balanceRemaining: z.number().nullable(),
  unbilledAccrued: z.number(),
  hoursUsed: z.number(),
  hoursOrdered: z.number().nullable(),
  deductions: z.array(
    z.object({
      invoiceId: z.string().uuid(),
      amount: z.number(),
      createdAt: z.coerce.date(),
    }),
  ),
});
export type DepositLedgerResponse = z.infer<typeof DepositLedgerResponseSchema>;

// Hours are stacked by ISO week (Mon-Sun, Asia/Manila report dates).
export interface StatementWeek {
  weekStart: string; // YYYY-MM-DD, a Monday
  weekEnd: string; // the Sunday
  hours: number;
  amount: number;
  fromDeposit: number;
  invoiced: number;
  unbilled: number;
}

export interface StatementOfAccount {
  rentalId: string;
  bookingCode: string | null;
  status: string;
  rentalStart: string;
  rentalEnd: string | null;
  company: { name: string; tin: string | null; billingAddress: string | null } | null;
  weeks: StatementWeek[];
  invoices: { id: string; invoiceType: string; amount: number; status: string; createdAt: string; dueDate: string }[];
  payments: { id: string; invoiceId: string; method: string; amount: number; status: string; createdAt: string }[];
  deposit: { required: number; deducted: number; remaining: number };
  totals: {
    // Excludes deposit deductions: those are paid from the deposit already on the booking invoice.
    charged: number;
    paid: number;
    unbilled: number;
    balanceDue: number;
  };
  generatedAt: string;
}
