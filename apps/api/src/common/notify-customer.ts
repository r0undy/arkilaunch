import { and, eq, inArray } from 'drizzle-orm';
import { customers, db, notifications, rentals, roles, users } from '@arkilaunch/db';

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

// Staff who act on customer requests. Owners read, they do not approve
// quotes or requests, so they are left out.
const STAFF_ALERT_ROLES = ['admin'];

// Drops a row into every active tenant admin's feed, so a customer's
// booking, counter-offer or request is seen without watching a list.
export async function notifyStaff(
  tx: Tx,
  tenantId: string,
  notificationType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const staff = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(inArray(roles.name, STAFF_ALERT_ROLES), eq(users.status, 'active')));
  if (staff.length === 0) return;
  await tx.insert(notifications).values(staff.map((user) => ({ tenantId, userId: user.id, notificationType, payload })));
}
