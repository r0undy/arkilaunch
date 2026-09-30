import { and, eq, inArray } from 'drizzle-orm';
import { invoices, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

// A deduction draws only on a paid deposit, so deduct-path specs give their rentals one.
export async function ensurePaidDeposit(ctx: RequestContext, ...rentalIds: string[]): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    for (const rentalId of rentalIds) {
      const [paid] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(eq(invoices.rentalId, rentalId), inArray(invoices.invoiceType, ['deposit', 'booking']), eq(invoices.status, 'paid')),
        )
        .limit(1);
      if (paid) continue;
      await tx.insert(invoices).values({
        tenantId: ctx.tenantId,
        rentalId,
        invoiceType: 'deposit',
        amount: '5000',
        status: 'paid',
        dueDate: new Date(),
      });
    }
  });
}
