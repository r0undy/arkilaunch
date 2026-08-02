import { and, desc, eq } from 'drizzle-orm';
import { invoices } from './schema/billing.js';
import { quotations, rentalContracts } from './schema/rentals.js';
import { db } from './client.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface DepositDeduction {
  invoiceId: string;
  amount: number;
  createdAt: Date;
}

export interface DepositLedger {
  // null when this rental has no quotation/rental_contracts chain (e.g. a
  // booking created directly via bookings.service.ts, which never quotes) --
  // there is no configured cap to measure a balance against, not a zero
  // deposit. See payments.service.ts's DEFAULT_DEPOSIT_PHP for the same gap
  // on the checkout side.
  depositRequired: number | null;
  deductions: DepositDeduction[];
  totalDeducted: number;
}

// Resolves a rental's configured deposit (rentals -> quotations ->
// rental_contracts, latest of each) and its deposit_deduction invoice
// history. Shared by edtr.service.ts's approve gate and billing.service.ts's
// ledger read so the two can never compute a different "remaining deposit"
// for the same rental.
export async function resolveDepositLedger(tx: Tx, rentalId: string): Promise<DepositLedger> {
  const [quotation] = await tx
    .select()
    .from(quotations)
    .where(eq(quotations.rentalId, rentalId))
    .orderBy(desc(quotations.createdAt))
    .limit(1);

  let depositRequired: number | null = null;
  if (quotation) {
    const [contract] = await tx
      .select()
      .from(rentalContracts)
      .where(eq(rentalContracts.quotationId, quotation.id))
      .orderBy(desc(rentalContracts.createdAt))
      .limit(1);
    if (contract) depositRequired = Number(contract.depositRequired);
  }

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

  return { depositRequired, deductions, totalDeducted };
}
