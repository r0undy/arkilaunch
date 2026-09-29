import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  customers,
  equipmentAssignments,
  events,
  invoices,
  notifications,
  payments,
  rentals,
  roles,
  users,
} from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// Skips any request with an online payment pending, so a PayMongo session in
// flight never lands on a cancelled booking.
const STAFF_ROLES = ['admin', 'owner'];
const noPendingOnlinePayment = sql`NOT EXISTS (SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE i.tenant_id = ${rentals.tenantId} AND p.tenant_id = ${rentals.tenantId}
    AND i.rental_id = ${rentals.id} AND p.status = 'pending' AND p.method <> 'cash')`;

export async function runHoldExpiry(now = new Date()): Promise<{ cancelled: string[] }> {
  const { db, client } = makeJobDb();
  const cancelled: string[] = [];
  try {
    // RLS is bypassed on this connection: every read and write after this
    // names the row's tenant explicitly.
    const lapsed = await db
      .select({ id: rentals.id, tenantId: rentals.tenantId, customerId: rentals.customerId })
      .from(rentals)
      .where(
        and(
          eq(rentals.status, 'pending'),
          lt(rentals.holdExpiresAt, now),
          noPendingOnlinePayment,
        ),
      );
    console.log(`hold-expiry: ${lapsed.length} lapsed hold(s).`);

    for (const hold of lapsed) {
      await db.transaction(async (tx) => {
        // Re-read under lock: staff may have extended it or the customer paid.
        const [still] = await tx
          .select({ id: rentals.id })
          .from(rentals)
          .where(
            and(
              eq(rentals.tenantId, hold.tenantId),
              eq(rentals.id, hold.id),
              eq(rentals.status, 'pending'),
              lt(rentals.holdExpiresAt, now),
            ),
          )
          .for('update');
        if (!still) return;
        // A separate statement: only a fresh snapshot sees a checkout that committed while we waited on the lock.
        const [unpaid] = await tx
          .select({ id: rentals.id })
          .from(rentals)
          .where(and(eq(rentals.tenantId, hold.tenantId), eq(rentals.id, hold.id), noPendingOnlinePayment));
        if (!unpaid) return;

        const open = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, hold.tenantId),
              eq(invoices.rentalId, hold.id),
              eq(invoices.status, 'issued'),
              inArray(invoices.invoiceType, ['booking', 'deposit']),
            ),
          );
        if (open.length > 0) {
          const ids = open.map((i) => i.id);
          // Only cash intents can be pending here (online ones were skipped).
          await tx
            .update(payments)
            .set({ status: 'failed' })
            .where(and(eq(payments.tenantId, hold.tenantId), inArray(payments.invoiceId, ids), eq(payments.status, 'pending')));
          await tx
            .update(invoices)
            .set({ status: 'void' })
            .where(and(eq(invoices.tenantId, hold.tenantId), inArray(invoices.id, ids)));
        }
        await tx
          .update(rentals)
          .set({ status: 'cancelled' })
          .where(and(eq(rentals.tenantId, hold.tenantId), eq(rentals.id, hold.id)));
        await tx
          .update(equipmentAssignments)
          .set({ status: 'cancelled' })
          .where(and(eq(equipmentAssignments.tenantId, hold.tenantId), eq(equipmentAssignments.rentalId, hold.id)));
        await tx.insert(events).values({
          tenantId: hold.tenantId,
          name: 'booking_hold_expired',
          properties: { rental_id: hold.id },
        });

        const [customer] = await tx
          .select({ userId: customers.userId })
          .from(customers)
          .innerJoin(users, eq(users.id, customers.userId))
          .where(and(eq(customers.tenantId, hold.tenantId), eq(customers.id, hold.customerId), eq(users.status, 'active')));
        const staff = await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(roles, eq(roles.id, users.roleId))
          .where(and(eq(users.tenantId, hold.tenantId), inArray(roles.name, STAFF_ROLES), eq(users.status, 'active')));
        const rows = [
          ...(customer?.userId ? [{ userId: customer.userId, audience: 'customer' }] : []),
          ...staff.map((s) => ({ userId: s.id, audience: 'staff' })),
        ];
        if (rows.length > 0) {
          await tx.insert(notifications).values(
            rows.map((row) => ({
              tenantId: hold.tenantId,
              userId: row.userId,
              notificationType: 'hold_expired',
              payload: { rental_id: hold.id, audience: row.audience },
            })),
          );
        }
        cancelled.push(hold.id);
      });
    }
    return { cancelled };
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'hold-expiry', runHoldExpiry);
