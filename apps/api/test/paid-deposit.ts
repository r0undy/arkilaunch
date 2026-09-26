import { and, eq, inArray } from 'drizzle-orm';
import { invoices, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

// An EDTR deduction draws only on a deposit actually paid (edtr.service.ts
// deposit_not_paid gate). Engine specs that exercise the deduct path give
// their rentals one, as checkout + webhook (or a cash receipt) would.
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
