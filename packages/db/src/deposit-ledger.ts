import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { billingSettings, depositAccruals, invoiceLineItems, invoices } from './schema/billing.js';
import { quotationItems, quotations, rentalContracts } from './schema/rentals.js';
import type { Tx } from './with-tenant-tx.js';
import { round2HalfUp } from '@arkilaunch/shared';


// Checkout and deduction both read the minimum through here so they cannot drift.
// ponytail: a no-contract rental reads the CURRENT setting, not the amount
// charged at its checkout; store it on the rental if tenants change it often.
export const DEFAULT_DEPOSIT_PHP = 5000;
export const DEFAULT_HOLD_HOURS = 48;

export interface BillingSettings {
  dailyHours: number;
  minDepositPhp: number;
  lowBalancePct: number;
  depositPct: number;
  mobilizationPhp: number;
  demobilizationPhp: number;
  minHours: number;
  holdHours: number;
}

export async function getBillingSettings(tx: Tx, tenantId: string): Promise<BillingSettings> {
  const [row] = await tx.select().from(billingSettings).where(eq(billingSettings.tenantId, tenantId)).limit(1);
  return {
    dailyHours: row ? Number(row.dailyHours) : 8,
    minDepositPhp: row ? Number(row.minDepositPhp) : DEFAULT_DEPOSIT_PHP,
    lowBalancePct: row ? Number(row.lowBalancePct) : 20,
    depositPct: row ? Number(row.depositPct) : 0,
    mobilizationPhp: row ? Number(row.mobilizationPhp) : 0,
    demobilizationPhp: row ? Number(row.demobilizationPhp) : 0,
    minHours: row ? Number(row.minHours) : 0,
    holdHours: row ? row.holdHours : DEFAULT_HOLD_HOURS,
  };
}

// depositPct% of the rented hours' worth; not refundable. No hours or pct 0 falls back to the flat minimum.
export function depositForQuote(settings: Pick<BillingSettings, 'minDepositPhp' | 'depositPct'>, rentedHoursValue: number | null): number {
  if (!rentedHoursValue || rentedHoursValue <= 0 || settings.depositPct <= 0) return settings.minDepositPhp;
  return round2HalfUp((rentedHoursValue * settings.depositPct) / 100);
}

export interface DepositDeduction {
  invoiceId: string;
  amount: number;
  createdAt: Date;
}

export interface DepositLedger {
  depositRequired: number;
  deductions: DepositDeduction[];
  totalDeducted: number;
  totalAccrued: number;
  unbilledAccrued: number;
  hoursUsed: number;
  hoursOrdered: number | null;
}

// Never throws: the RFC-2 gate (reconciled or human-approved) ran before.
export function splitDeduction(balanceBefore: number, amount: number) {
  const available = Math.max(0, round2HalfUp(balanceBefore));
  const deducted = Math.min(available, round2HalfUp(amount));
  return { deducted, accrued: round2HalfUp(amount - deducted), balanceAfter: round2HalfUp(available - deducted) };
}

// True only on the charge that takes the balance to or under pct% of the
// deposit, so each rental warns once, not on every later log.
export function crossesLowBalance(depositRequired: number, before: number, after: number, pct: number): boolean {
  const threshold = (depositRequired * pct) / 100;
  return depositRequired > 0 && before > threshold && after <= threshold;
}

// Shared by approve and the ledger read so both compute the same remaining deposit.
export async function resolveDepositLedger(tx: Tx, rentalId: string, tenantId: string): Promise<DepositLedger> {
  const [quotation] = await tx
    .select()
    .from(quotations)
    .where(eq(quotations.rentalId, rentalId))
    .orderBy(desc(quotations.createdAt))
    .limit(1);

  let depositRequired: number | null = null;
  let hoursOrdered: number | null = null;
  if (quotation) {
    const [contract] = await tx
      .select()
      .from(rentalContracts)
      .where(eq(rentalContracts.quotationId, quotation.id))
      .orderBy(desc(rentalContracts.createdAt))
      .limit(1);
    if (contract) depositRequired = Number(contract.depositRequired);
    const [ordered] = await tx
      .select({ hours: sql<string | null>`sum(${quotationItems.estimatedHours} * ${quotationItems.quantity})` })
      .from(quotationItems)
      .where(eq(quotationItems.quotationId, quotation.id));
    hoursOrdered = ordered?.hours != null ? Number(ordered.hours) : null;
  }
  if (depositRequired === null) depositRequired = (await getBillingSettings(tx, tenantId)).minDepositPhp;

  const deductionRows = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.rentalId, rentalId), eq(invoices.invoiceType, 'deposit_deduction')))
    .orderBy(desc(invoices.createdAt));

  const deductions = deductionRows.map((row) => ({
    invoiceId: row.id,
    amount: Number(row.amount),
    createdAt: row.createdAt,
  }));
  const totalDeducted = round2HalfUp(deductions.reduce((sum, deduction) => sum + deduction.amount, 0));

  const deductionHours = deductionRows.length
    ? await tx
        .select({ hours: sql<string | null>`sum(${invoiceLineItems.quantity})` })
        .from(invoiceLineItems)
        .where(inArray(invoiceLineItems.invoiceId, deductionRows.map((row) => row.id)))
    : [];
  const accruals = await tx.select().from(depositAccruals).where(eq(depositAccruals.rentalId, rentalId));
  const totalAccrued = round2HalfUp(accruals.reduce((sum, row) => sum + Number(row.amount), 0));
  const unbilledAccrued = round2HalfUp(accruals.filter((row) => !row.invoiceId).reduce((sum, row) => sum + Number(row.amount), 0));
  const hoursUsed = round2HalfUp(
    Number(deductionHours[0]?.hours ?? 0) + accruals.reduce((sum, row) => sum + Number(row.hours), 0),
  );

  return { depositRequired, deductions, totalDeducted, totalAccrued, unbilledAccrued, hoursUsed, hoursOrdered };
}
