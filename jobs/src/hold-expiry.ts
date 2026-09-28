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
import { runInstrumentedJob } from './telemetry.js';

// QA 25 (cr-arkilaunch-qa-batch-23-28.md): an unpaid request holds its
// dates until rentals.hold_expires_at. The availability check already stops
// a lapsed hold blocking anyone (apps/api/src/common/equipment-availability.ts
// liveHold); this sweep closes it out -- cancelled, its unpaid invoices
// voided -- and tells the customer and the rental team, hourly.
//
// Never touches money that may be moving: a request with an online payment
// still pending is skipped (the availability check keeps it held too), so
// a PayMongo session in flight can never land on a cancelled booking.
const STAFF_ROLES = ['admin', 'owner'];

export async function runHoldExpiry(now = new Date()): Promise<{ cancelled: string[] }> {
  const { db, client } = makeJobDb();
  const cancelled: string[] = [];
  try {
    const lapsed = await db
      .select({ id: rentals.id, tenantId: rentals.tenantId, customerId: rentals.customerId })
      .from(rentals)
      .where(
        and(
          eq(rentals.status, 'pending'),
          lt(rentals.holdExpiresAt, now),
          sql`NOT EXISTS (SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id
            WHERE i.rental_id = ${rentals.id} AND p.status = 'pending' AND p.method <> 'cash')`,
        ),
      );
    console.log(`hold-expiry: ${lapsed.length} lapsed hold(s).`);

    for (const hold of lapsed) {
      await db.transaction(async (tx) => {
        // Re-read under lock: staff may have extended it, or the customer
        // paid, since the scan.
        const [still] = await tx
          .select({ id: rentals.id })
          .from(rentals)
          .where(and(eq(rentals.id, hold.id), eq(rentals.status, 'pending'), lt(rentals.holdExpiresAt, now)))
          .for('update');
        if (!still) return;

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
            .where(and(inArray(payments.invoiceId, ids), eq(payments.status, 'pending')));
          await tx.update(invoices).set({ status: 'void' }).where(inArray(invoices.id, ids));
        }
        await tx.update(rentals).set({ status: 'cancelled' }).where(eq(rentals.id, hold.id));
        await tx
          .update(equipmentAssignments)
          .set({ status: 'cancelled' })
          .where(and(eq(equipmentAssignments.tenantId, hold.tenantId), eq(equipmentAssignments.rentalId, hold.id)));
        // audit_logs needs a human actor; the sweep's record is the event.
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

const isMainModule =
  process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('hold-expiry', async () => {
    await runHoldExpiry();
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
