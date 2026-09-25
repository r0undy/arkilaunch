import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { billingSettings, depositAccruals, invoiceLineItems, invoices } from './schema/billing.js';
import { quotationItems, quotations, rentalContracts } from './schema/rentals.js';
import { db } from './client.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Default for billing_settings.min_deposit_php when a tenant never set one.
// The tenant setting (getBillingSettings) is what checkout charges and what
// a deduction measures against when a rental has no contract; both sides
// read it through here so they cannot drift (audit-ocr-money-path.md #5).
// ponytail: a no-contract rental reads the CURRENT setting, not the amount
// charged at its checkout; store it on the rental if tenants change it often.
export const DEFAULT_DEPOSIT_PHP = 5000;

export interface BillingSettings {
  dailyHours: number;
  minDepositPhp: number;
  lowBalancePct: number;
  depositPct: number;
  mobilizationPhp: number;
  demobilizationPhp: number;
  minHours: number;
}

// The tenant's billing knobs; the 0038 column defaults when never set.
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
  };
}

// The consumable deposit a quote opens its contract with: depositPct% of
// the rented hours' worth (sum of hours x quantity x quoted hourly rate),
// so 50% of a 50-hour rental prepays 25 hours. Not refundable: approved
// EDTR hours draw it down and the low-balance warning fires at
// lowBalancePct. No hours value, or pct 0, falls back to the flat minimum.
export function depositForQuote(settings: Pick<BillingSettings, 'minDepositPhp' | 'depositPct'>, rentedHoursValue: number | null): number {
  if (!rentedHoursValue || rentedHoursValue <= 0 || settings.depositPct <= 0) return settings.minDepositPhp;
  return cents((rentedHoursValue * settings.depositPct) / 100);
}

export interface DepositDeduction {
  invoiceId: string;
  amount: number;
  createdAt: Date;
}

export interface DepositLedger {
  // The rental's contract deposit_required, else the tenant's minimum
  // deposit (what checkout charged when there was no quote chain).
  depositRequired: number;
  deductions: DepositDeduction[];
  totalDeducted: number;
  // Reconciled work billed past the balance (deposit_accruals).
  totalAccrued: number;
  unbilledAccrued: number;
  // Billed hours (deduction lines + accruals) vs the quote's hours.
  hoursUsed: number;
  hoursOrdered: number | null;
}

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Rollover: what an approved charge takes from the deposit, and what
// overflows into an unbilled accrual for the weekly invoice. Never throws:
// the gate that matters (reconciled or human-approved, RFC-2) ran before.
export function splitDeduction(balanceBefore: number, amount: number) {
  const available = Math.max(0, cents(balanceBefore));
  const deducted = Math.min(available, cents(amount));
  return { deducted, accrued: cents(amount - deducted), balanceAfter: cents(available - deducted) };
}

// True only on the charge that takes the balance to or under pct% of the
// deposit, so each rental warns once, not on every later log.
export function crossesLowBalance(depositRequired: number, before: number, after: number, pct: number): boolean {
  const threshold = (depositRequired * pct) / 100;
  return depositRequired > 0 && before > threshold && after <= threshold;
}

// Resolves a rental's deposit (rentals -> quotations -> rental_contracts,
// latest of each; else the tenant minimum), its deposit_deduction history
// and its accruals. Shared by edtr.service.ts's approve and
// billing.service.ts's ledger read so the two can never compute a
// different "remaining deposit" for the same rental.
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
  const totalDeducted = deductions.reduce((sum, deduction) => sum + deduction.amount, 0);

  const deductionHours = deductionRows.length
    ? await tx
        .select({ hours: sql<string | null>`sum(${invoiceLineItems.quantity})` })
        .from(invoiceLineItems)
        .where(inArray(invoiceLineItems.invoiceId, deductionRows.map((row) => row.id)))
    : [];
  const accruals = await tx.select().from(depositAccruals).where(eq(depositAccruals.rentalId, rentalId));
  const totalAccrued = cents(accruals.reduce((sum, row) => sum + Number(row.amount), 0));
  const unbilledAccrued = cents(accruals.filter((row) => !row.invoiceId).reduce((sum, row) => sum + Number(row.amount), 0));
  const hoursUsed = cents(
    Number(deductionHours[0]?.hours ?? 0) + accruals.reduce((sum, row) => sum + Number(row.hours), 0),
  );

  return { depositRequired, deductions, totalDeducted, totalAccrued, unbilledAccrued, hoursUsed, hoursOrdered };
}
