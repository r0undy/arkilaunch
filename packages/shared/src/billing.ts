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
