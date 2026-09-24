import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  db,
  edtrReconciliations,
  invoiceLineItems,
  invoices,
  rentals,
  resolveDepositLedger,
  truckRequests,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  DepositLedgerResponse,
  EdtrDeductionEvidence,
  InvoiceDetailResponse,
  InvoiceListQuery,
  InvoiceListResponse,
  InvoiceSummaryResponse,
  RequestContext,
} from '@arkilaunch/shared';
import { countRows } from '../common/count-rows.js';
import { ownsCustomer } from '../common/customer-scope.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function customerOwnsInvoice(
  tx: Tx,
  ctx: RequestContext,
  invoice: typeof invoices.$inferSelect,
): Promise<boolean> {
  if (invoice.truckRequestId) {
    const [request] = await tx
      .select({ requestedBy: truckRequests.requestedBy })
      .from(truckRequests)
      .where(eq(truckRequests.id, invoice.truckRequestId))
      .limit(1);
    return request?.requestedBy === ctx.userId;
  }
  if (!invoice.rentalId) return false;
  const [rental] = await tx
    .select({ customerId: rentals.customerId })
    .from(rentals)
    .where(eq(rentals.id, invoice.rentalId))
    .limit(1);
  return rental ? ownsCustomer(tx, ctx, rental.customerId) : false;
}

function toInvoiceSummary(row: typeof invoices.$inferSelect): InvoiceSummaryResponse {
  return {
    id: row.id,
    rentalId: row.rentalId,
    truckRequestId: row.truckRequestId,
    invoiceType: row.invoiceType,
    amount: Number(row.amount),
    status: row.status,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
  };
}

// Legacy fallback only. invoice_line_items.reconciliation_id is now a real
// FK and is what approve() writes and what this reader prefers; the
// pattern below is kept for rows written before that column existed and
// which the backfill could not resolve (audit-db-tenant-isolation.md #3).
// A text description can be edited or reformatted; a foreign key cannot.
const EDTR_EVIDENCE_PATTERN =
  /^EDTR reconciliation ([0-9a-fA-F-]{36}) \(sources: ([0-9a-fA-F-]{36}), ([0-9a-fA-F-]{36}|n\/a)\)$/;

async function findEdtrEvidence(tx: Tx, lineItems: (typeof invoiceLineItems.$inferSelect)[]) {
  // Structured link first.
  for (const item of lineItems) {
    if (!item.reconciliationId) continue;
    const [reconciliation] = await tx
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.id, item.reconciliationId))
      .limit(1);
    if (!reconciliation) continue;
    return {
      reconciliationId: reconciliation.id,
      sourceEdtrIds: [reconciliation.edtrId, reconciliation.counterpartEdtrId].filter(
        (id): id is string => Boolean(id),
      ),
      status: reconciliation.status,
      deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
      tolerance: Number(reconciliation.tolerance),
    } satisfies EdtrDeductionEvidence;
  }

  for (const item of lineItems) {
    const match = EDTR_EVIDENCE_PATTERN.exec(item.description);
    if (!match) continue;
    const [, reconciliationId, sourceA, sourceB] = match;
    const [reconciliation] = await tx
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.id, reconciliationId!))
      .limit(1);
    if (!reconciliation) continue;
    return {
      reconciliationId: reconciliation.id,
      sourceEdtrIds: sourceB === 'n/a' ? [sourceA!] : [sourceA!, sourceB!],
      status: reconciliation.status,
      deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
      tolerance: Number(reconciliation.tolerance),
    } satisfies EdtrDeductionEvidence;
  }
  return null;
}

// PRD-F2/F3 read surface backing S9 Billing & Deposit Ledger
// (cr-arkilaunch-f9-read-surface.md). Read-only: writes to invoices/
// payments/edtr_reconciliations happen exclusively in edtr.service.ts and
// payments.service.ts. billing:read-gated (owner is read-mostly, QAD-T19).
@Injectable()
export class BillingService {
  // GET /api/v1/invoices?rentalId=&invoiceType=&status=&from=&to=&limit=&offset=
  async listInvoices(ctx: RequestContext, query: InvoiceListQuery): Promise<InvoiceListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (query.rentalId) conditions.push(eq(invoices.rentalId, query.rentalId));
      if (query.invoiceType) conditions.push(eq(invoices.invoiceType, query.invoiceType));
      if (query.status) conditions.push(eq(invoices.status, query.status));
      if (query.from) conditions.push(gte(invoices.createdAt, new Date(`${query.from}T00:00:00Z`)));
      if (query.to) conditions.push(lte(invoices.createdAt, new Date(`${query.to}T23:59:59.999Z`)));

      const rows = await tx
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const total = await countRows(tx, invoices, and(...conditions));

      return { items: rows.map(toInvoiceSummary), total };
    });
  }

  // GET /api/v1/invoices/:id (evidence trail: the edtr_reconciliations row,
  // both source edtr ids, and the audit_logs DEDUCT row -- SDD §4 "invoice
  // line cites both source logs", QAD-T1).
  async getInvoice(ctx: RequestContext, id: string): Promise<InvoiceDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!invoice) throw new NotFoundException({ error: 'invoice_not_found' });
      // A customer (GET /me/invoices/:id) reads only an invoice on their own
      // booking or truck request; anything else is a 404, not a 403, so ids
      // cannot be probed.
      if (ctx.role === 'customer' && !(await customerOwnsInvoice(tx, ctx, invoice))) {
        throw new NotFoundException({ error: 'invoice_not_found' });
      }

      const lineItemRows = await tx
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, id));
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entity, 'invoices'), eq(auditLogs.entityId, id)))
        .orderBy(desc(auditLogs.timestamp));

      const edtrEvidence = invoice.invoiceType === 'deposit_deduction' ? await findEdtrEvidence(tx, lineItemRows) : null;

      return {
        ...toInvoiceSummary(invoice),
        lineItems: lineItemRows.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.amount),
        })),
        edtrEvidence,
        auditTrail: auditRows.map((row) => ({ action: row.action, actorId: row.actorId, timestamp: row.timestamp })),
      };
    });
  }

  // GET /api/v1/rentals/:id/deposit (S9 deposit ledger). Same resolution
  // path as edtr.service.ts's approve gate (resolveDepositLedger) so the
  // two can never disagree about a rental's remaining deposit.
  async depositLedger(ctx: RequestContext, rentalId: string): Promise<DepositLedgerResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'rental_not_found' });

      const ledger = await resolveDepositLedger(tx, rentalId);
      return {
        rentalId,
        depositRequired: ledger.depositRequired,
        totalDeducted: ledger.totalDeducted,
        balanceRemaining: ledger.depositRequired !== null ? ledger.depositRequired - ledger.totalDeducted : null,
        deductions: ledger.deductions,
      };
    });
  }
}
