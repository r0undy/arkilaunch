import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, type SQL } from 'drizzle-orm';
import {
  type Tx,
  auditLogs,
  customers,
  depositAccruals,
  sendEmail,
  users,
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
  StatementEmailResponse,
  StatementOfAccount,
  StatementPdfResponse,
  StatementWeek,
} from '@arkilaunch/shared';
import { renderStatementPdf } from './statement-pdf.js';
import { tenantBrand } from '../common/tenant-brand.js';
import { personName } from '../common/field-logs.js';
import { bookingCodes, invoiceBookingRef } from '../common/booking-ref.js';
import { countRows } from '../common/count-rows.js';
import { customerOwnsInvoice, ownsCustomer } from '../common/customer-scope.js';
import { round2HalfUp } from '@arkilaunch/shared';


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

// Legacy fallback for rows predating invoice_line_items.reconciliation_id; the FK is preferred.
const EDTR_EVIDENCE_PATTERN =
  /^EDTR reconciliation ([0-9a-fA-F-]{36}) \(sources: ([0-9a-fA-F-]{36}), ([0-9a-fA-F-]{36}|n\/a)\)$/;

async function findEdtrEvidence(tx: Tx, lineItems: (typeof invoiceLineItems.$inferSelect)[]) {
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

@Injectable()
export class BillingService {
  async listInvoices(ctx: RequestContext, query: InvoiceListQuery): Promise<InvoiceListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (query.rentalId) conditions.push(eq(invoices.rentalId, query.rentalId));
      if (query.invoiceType) conditions.push(eq(invoices.invoiceType, query.invoiceType));
      if (query.status) conditions.push(eq(invoices.status, query.status));
      // Manila days: [from 00:00 +08:00, the day after `to`).
      if (query.from) conditions.push(gte(invoices.createdAt, new Date(`${query.from}T00:00:00+08:00`)));
      if (query.to) conditions.push(lt(invoices.createdAt, new Date(new Date(`${query.to}T00:00:00+08:00`).getTime() + 86_400_000)));

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

  async getInvoice(ctx: RequestContext, id: string): Promise<InvoiceDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!invoice) throw new NotFoundException({ error: 'invoice_not_found' });
      // A customer reads only their own booking's or truck request's invoice; 404, not 403, so ids can't be probed.
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

  // resolveDepositLedger, same as the approve gate, so the two never disagree.
  async depositLedger(ctx: RequestContext, rentalId: string): Promise<DepositLedgerResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'rental_not_found' });

      const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
      return {
        rentalId,
        depositRequired: ledger.depositRequired,
        totalDeducted: ledger.totalDeducted,
        balanceRemaining: round2HalfUp(Math.max(0, ledger.depositRequired - ledger.totalDeducted)),
        unbilledAccrued: ledger.unbilledAccrued,
        hoursUsed: ledger.hoursUsed,
        hoursOrdered: ledger.hoursOrdered,
        deductions: ledger.deductions,
      };
    });
  }

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
        row.hours = round2HalfUp(row.hours + Number(d.hours));
        row.amount = round2HalfUp(row.amount + Number(d.amount));
        row.fromDeposit = round2HalfUp(row.fromDeposit + Number(d.amount));
      }
      for (const a of accrued) {
        const row = week(a.day);
        row.hours = round2HalfUp(row.hours + Number(a.hours));
        row.amount = round2HalfUp(row.amount + Number(a.amount));
        if (a.invoiceId) row.invoiced = round2HalfUp(row.invoiced + Number(a.amount));
        else row.unbilled = round2HalfUp(row.unbilled + Number(a.amount));
      }

      const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
      const charged = round2HalfUp(invoiceRows.filter((i) => i.invoiceType !== 'deposit_deduction').reduce((sum, i) => sum + Number(i.amount), 0));
      const paid = round2HalfUp(paymentRows.filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount), 0));
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
          remaining: round2HalfUp(Math.max(0, ledger.depositRequired - ledger.totalDeducted)),
        },
        totals: {
          charged,
          paid,
          unbilled: ledger.unbilledAccrued,
          balanceDue: round2HalfUp(Math.max(0, charged - paid) + ledger.unbilledAccrued),
        },
        generatedAt: new Date().toISOString(),
        lastEmailed: ctx.role === 'customer' ? null : await lastStatementEmail(tx, rentalId),
      };
    });
  }

  async statementPdf(ctx: RequestContext, rentalId: string): Promise<StatementPdfResponse> {
    const soa = await this.statement(ctx, rentalId);
    const bytes = await renderStatementPdf(soa, await this.brand(ctx));
    return { filename: `soa-${soa.bookingCode ?? rentalId}.pdf`, contentBase64: Buffer.from(bytes).toString('base64') };
  }

  // The office sends the PDF by hand after checking it; the customer's account email receives it.
  async emailStatement(ctx: RequestContext, rentalId: string): Promise<StatementEmailResponse> {
    const soa = await this.statement(ctx, rentalId);
    const to = await withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select({ email: users.email })
        .from(rentals)
        .innerJoin(customers, eq(customers.id, rentals.customerId))
        .innerJoin(users, eq(users.id, customers.userId))
        .where(eq(rentals.id, rentalId))
        .limit(1);
      return row?.email ?? null;
    });
    if (!to) throw new UnprocessableEntityException({ error: 'customer_email_missing' });
    const brand = await this.brand(ctx);
    const pdf = await renderStatementPdf(soa, brand);
    const code = soa.bookingCode ?? rentalId;
    await sendEmail(
      to,
      `Statement of Account ${code} from ${brand.name}`,
      `Attached is the Statement of Account for booking ${code}. Balance due: PHP ${soa.totals.balanceDue.toFixed(2)}.`,
      undefined,
      [{ filename: `soa-${code}.pdf`, content: Buffer.from(pdf).toString('base64') }],
    );
    const sentAt = new Date();
    await withTenantTx(ctx, (tx) =>
      tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'CREATE', entity: 'statement_emailed', entityId: rentalId, timestamp: sentAt }),
    );
    return { sentTo: to, sentAt: sentAt.toISOString() };
  }

  private brand(ctx: RequestContext) {
    return tenantBrand(ctx);
  }
}

async function lastStatementEmail(tx: Tx, rentalId: string) {
  const [row] = await tx
    .select({ at: auditLogs.timestamp, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, 'statement_emailed'), eq(auditLogs.entityId, rentalId)))
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);
  return row ? { at: row.at.toISOString(), by: row.email ? (personName({ firstName: row.firstName, lastName: row.lastName, email: row.email }) ?? null) : null } : null;
}
