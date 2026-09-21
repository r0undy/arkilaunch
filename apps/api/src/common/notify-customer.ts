import { eq } from 'drizzle-orm';
import { customers, db, notifications, rentals } from '@arkilaunch/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Drops a row into the booking customer's in-app feed (notifications.tsx).
// Runs inside the caller's tenant transaction so RLS scopes it; a customer
// record with no login (customers.user_id null) simply gets nothing.
export async function notifyBookingCustomer(
  tx: Tx,
  tenantId: string,
  rentalId: string,
  notificationType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const [row] = await tx
    .select({ userId: customers.userId })
    .from(rentals)
    .innerJoin(customers, eq(customers.id, rentals.customerId))
    .where(eq(rentals.id, rentalId))
    .limit(1);
  if (!row?.userId) return;
  await tx.insert(notifications).values({
    tenantId,
    userId: row.userId,
    notificationType,
    payload: { rental_id: rentalId, ...payload },
  });
}
