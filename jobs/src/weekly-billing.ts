import { and, eq, inArray, isNull } from 'drizzle-orm';
import { customers, depositAccruals, invoiceLineItems, invoices, notifications, publicPhotoUrl, rentals, sendEmail, tenants, users } from '@arkilaunch/db';
import { notificationEmail, renderEmailHtml } from '@arkilaunch/shared';
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
      // Sent after the commit, so a rolled-back run mails nobody.
      let mail = null as { to: string; subject: string; text: string; html: string } | null;
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
          .select({ userId: customers.userId, code: rentals.code, email: users.email, prefs: users.notificationPrefs })
          .from(rentals)
          .innerJoin(customers, eq(customers.id, rentals.customerId))
          .leftJoin(users, eq(users.id, customers.userId))
          .where(eq(rentals.id, rentalId))
          .limit(1);
        if (owner?.userId) {
          await tx.insert(notifications).values({
            tenantId,
            userId: owner.userId,
            notificationType: 'weekly_invoice',
            payload: { rental_id: rentalId, invoice_id: invoice.id, amount_php: amount },
          });
          const email =
            owner.email && owner.prefs?.email
              ? notificationEmail(
                  'weekly_invoice',
                  { invoiceId: invoice.id, code: owner.code, amountPhp: amount, dueDate: invoice.dueDate, rentalId, truckRequestId: null },
                  'customer',
                  process.env.WEB_ORIGIN ?? 'http://localhost:5173',
                )
              : null;
          if (email && owner.email) {
            // Superuser connection: the tenant is named explicitly.
            const [brand] = await tx
              .select({ name: tenants.legalName, logoKey: tenants.logoKey, color: tenants.primaryColor })
              .from(tenants)
              .where(eq(tenants.id, tenantId))
              .limit(1);
            const html = renderEmailHtml(
              { name: brand?.name ?? 'ArkiLaunch', logoUrl: publicPhotoUrl(brand?.logoKey ?? null), color: brand?.color ?? null },
              email.text,
            );
            mail = { to: owner.email, ...email, html };
          }
        }
        issued += 1;
      });
      if (mail) {
        const { to, subject, text, html } = mail;
        await sendEmail(to, subject, text, html).catch((err) => console.error('weekly-billing: invoice email failed', err));
      }
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
