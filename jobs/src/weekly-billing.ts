import { and, eq, inArray, isNull } from 'drizzle-orm';
import { customers, depositAccruals, invoiceLineItems, invoices, notifications, rentals } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runInstrumentedJob } from './telemetry.js';

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Weekly: every rental's unbilled deposit_accruals (reconciled hours billed
// past the deposit balance, edtr.service.ts approve) roll into ONE
// invoice_type='weekly' invoice, payable by PayMongo or cash through the
// existing flows (POST /me/invoices/:id/checkout, /invoices/:id/cash-payment).
// This job moves no money and prices nothing: it only bills rows a
// reconciled or human-approved pair already created (RFC-2). Superuser
// connection, so every write carries the row's own tenant_id explicitly.
export async function runWeeklyBilling(): Promise<number> {
  const { db, client } = makeJobDb();
  let issued = 0;
  try {
    const open = await db
      .selectDistinct({ tenantId: depositAccruals.tenantId, rentalId: depositAccruals.rentalId })
      .from(depositAccruals)
      .where(isNull(depositAccruals.invoiceId));

    for (const { tenantId, rentalId } of open) {
      await db.transaction(async (tx) => {
        // Locked so a concurrent run cannot bill the same rows twice.
        const rows = await tx
          .select()
          .from(depositAccruals)
          .where(and(eq(depositAccruals.rentalId, rentalId), isNull(depositAccruals.invoiceId)))
          .for('update');
        if (rows.length === 0) return;
        const amount = cents(rows.reduce((sum, row) => sum + Number(row.amount), 0));

        const [invoice] = await tx
          .insert(invoices)
          .values({
            tenantId,
            rentalId,
            invoiceType: 'weekly',
            amount: String(amount),
            status: 'issued',
            dueDate: new Date(Date.now() + 7 * 86_400_000),
          })
          .returning();
        if (!invoice) throw new Error('weekly invoice insert returned no row');

        await tx.insert(invoiceLineItems).values(
          rows.map((row) => ({
            tenantId,
            invoiceId: invoice.id,
            reconciliationId: row.reconciliationId,
            description: `Hours past the deposit (EDTR reconciliation ${row.reconciliationId})`,
            quantity: row.hours,
            unitPrice: row.unitPrice,
            amount: row.amount,
          })),
        );
        await tx
          .update(depositAccruals)
          .set({ invoiceId: invoice.id })
          .where(inArray(depositAccruals.id, rows.map((row) => row.id)));
        const [owner] = await tx
          .select({ userId: customers.userId })
          .from(rentals)
          .innerJoin(customers, eq(customers.id, rentals.customerId))
          .where(eq(rentals.id, rentalId))
          .limit(1);
        if (owner?.userId) {
          await tx.insert(notifications).values({
            tenantId,
            userId: owner.userId,
            notificationType: 'weekly_invoice',
            payload: { rental_id: rentalId, invoice_id: invoice.id, amount_php: amount },
          });
        }
        issued += 1;
      });
    }
    console.log(`weekly-billing: issued ${issued} weekly invoice(s).`);
    return issued;
  } finally {
    await client.end();
  }
}

const isMainModule =
  process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('weekly-billing', async () => {
    await runWeeklyBilling();
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
