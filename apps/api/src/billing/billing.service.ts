import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  customers,
  db,
  depositAccruals,
  edtr,
  edtrReconciliations,
  invoiceLineItems,
  invoices,
  payments,
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
  StatementOfAccount,
  StatementWeek,
} from '@arkilaunch/shared';
import { bookingCodes, invoiceBookingRef } from '../common/booking-ref.js';
import { countRows } from '../common/count-rows.js';
import { customerOwnsInvoice, ownsCustomer } from '../common/customer-scope.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const cents = (n: number) => Math.round(n * 100) / 100;

// Monday and Sunday of a YYYY-MM-DD report date's ISO week.
export function isoWeek(day: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 6);
  return { weekStart: d.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) };
}

function toInvoiceSummary(row: typeof invoices.$inferSelect, codes: Map<string, string>): InvoiceSummaryResponse {
  return {
    id: row.id,
    rentalId: row.rentalId,
    truckRequestId: row.truckRequestId,
    bookingCode: invoiceBookingRef(row, codes)?.code ?? null,
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

// The company an invoice bills: its booking's, or its truck trip's.
async function billTo(tx: Tx, invoice: typeof invoices.$inferSelect) {
  const [row] = invoice.rentalId
    ? await tx.select({ customerId: rentals.customerId }).from(rentals).where(eq(rentals.id, invoice.rentalId)).limit(1)
    : invoice.truckRequestId
      ? await tx
          .select({ customerId: truckRequests.customerId })
          .from(truckRequests)
          .where(eq(truckRequests.id, invoice.truckRequestId))
          .limit(1)
      : [];
  if (!row?.customerId) return null;
  const [company] = await tx
    .select({ companyName: customers.companyName, tin: customers.tin, billingAddress: customers.billingAddress })
    .from(customers)
    .where(eq(customers.id, row.customerId))
    .limit(1);
  return company ?? null;
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

      const codes = await bookingCodes(tx, {
        rentalIds: rows.map((row) => row.rentalId),
        truckRequestIds: rows.map((row) => row.truckRequestId),
      });
      return { items: rows.map((row) => toInvoiceSummary(row, codes)), total };
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
        ...toInvoiceSummary(
          invoice,
          await bookingCodes(tx, { rentalIds: [invoice.rentalId], truckRequestIds: [invoice.truckRequestId] }),
        ),
        lineItems: lineItemRows.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.amount),
        })),
        billTo: await billTo(tx, invoice),
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

      const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
      return {
        rentalId,
        depositRequired: ledger.depositRequired,
        totalDeducted: ledger.totalDeducted,
        balanceRemaining: Math.max(0, ledger.depositRequired - ledger.totalDeducted),
        unbilledAccrued: ledger.unbilledAccrued,
        hoursUsed: ledger.hoursUsed,
        hoursOrdered: ledger.hoursOrdered,
        deductions: ledger.deductions,
      };
    });
  }

  // GET /rentals/:id/statement (staff) and /me/rentals/:id/statement (the
  // customer's own booking). Read-only, computed from the rows that already
  // hold the money: deposit-deduction lines and accruals (each tied to one
  // reconciled EDTR day), invoices and payments.
  async statement(ctx: RequestContext, rentalId: string): Promise<StatementOfAccount> {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental || (ctx.role === 'customer' && !(await ownsCustomer(tx, ctx, rental.customerId)))) {
        throw new NotFoundException({ error: 'rental_not_found' });
      }
      const [company] = await tx
        .select({ name: customers.companyName, tin: customers.tin, billingAddress: customers.billingAddress })
        .from(customers)
        .where(eq(customers.id, rental.customerId))
        .limit(1);

      const invoiceRows = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, rentalId), ne(invoices.status, 'void')))
        .orderBy(asc(invoices.createdAt));
      const paymentRows = invoiceRows.length
        ? await tx
            .select()
            .from(payments)
            .where(inArray(payments.invoiceId, invoiceRows.map((i) => i.id)))
            .orderBy(asc(payments.createdAt))
        : [];

      // Each charge's work day, via its reconciliation's EDTR.
      const deductionIds = invoiceRows.filter((i) => i.invoiceType === 'deposit_deduction').map((i) => i.id);
      const deducted = deductionIds.length
        ? await tx
            .select({ hours: invoiceLineItems.quantity, amount: invoiceLineItems.amount, day: edtr.reportDate })
            .from(invoiceLineItems)
            .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, invoiceLineItems.reconciliationId))
            .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
            .where(and(inArray(invoiceLineItems.invoiceId, deductionIds), isNotNull(invoiceLineItems.reconciliationId)))
        : [];
      const accrued = await tx
        .select({ hours: depositAccruals.hours, amount: depositAccruals.amount, invoiceId: depositAccruals.invoiceId, day: edtr.reportDate })
        .from(depositAccruals)
        .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
        .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
        .where(eq(depositAccruals.rentalId, rentalId));

      const weeks = new Map<string, StatementWeek>();
      const week = (day: string) => {
        const w = isoWeek(day);
        let row = weeks.get(w.weekStart);
        if (!row) {
          row = { ...w, hours: 0, amount: 0, fromDeposit: 0, invoiced: 0, unbilled: 0 };
          weeks.set(w.weekStart, row);
        }
        return row;
      };
      for (const d of deducted) {
        const row = week(d.day);
        row.hours = cents(row.hours + Number(d.hours));
        row.amount = cents(row.amount + Number(d.amount));
        row.fromDeposit = cents(row.fromDeposit + Number(d.amount));
      }
      for (const a of accrued) {
        const row = week(a.day);
        row.hours = cents(row.hours + Number(a.hours));
        row.amount = cents(row.amount + Number(a.amount));
        if (a.invoiceId) row.invoiced = cents(row.invoiced + Number(a.amount));
        else row.unbilled = cents(row.unbilled + Number(a.amount));
      }

      const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
      const charged = cents(invoiceRows.filter((i) => i.invoiceType !== 'deposit_deduction').reduce((sum, i) => sum + Number(i.amount), 0));
      const paid = cents(paymentRows.filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount), 0));
      return {
        rentalId,
        bookingCode: rental.code,
        status: rental.status,
        rentalStart: rental.startDate.toISOString(),
        rentalEnd: rental.endDate?.toISOString() ?? null,
        company: company ?? null,
        weeks: [...weeks.values()].sort((x, y) => x.weekStart.localeCompare(y.weekStart)),
        invoices: invoiceRows.map((i) => ({
          id: i.id,
          invoiceType: i.invoiceType,
          amount: Number(i.amount),
          status: i.status,
          createdAt: i.createdAt.toISOString(),
          dueDate: i.dueDate.toISOString(),
        })),
        payments: paymentRows.map((p) => ({
          id: p.id,
          invoiceId: p.invoiceId,
          method: p.method,
          amount: Number(p.amount),
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
        deposit: {
          required: ledger.depositRequired,
          deducted: ledger.totalDeducted,
          remaining: cents(Math.max(0, ledger.depositRequired - ledger.totalDeducted)),
        },
        totals: {
          charged,
          paid,
          unbilled: ledger.unbilledAccrued,
          balanceDue: cents(Math.max(0, charged - paid) + ledger.unbilledAccrued),
        },
        generatedAt: new Date().toISOString(),
      };
    });
  }
}
