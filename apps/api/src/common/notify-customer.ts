import { and, eq, inArray } from 'drizzle-orm';
import {
  type Tx,
  afterCommit,
  customers,
  invoices,
  notifications,
  publicPhotoUrl,
  rentals,
  roles,
  sendEmail,
  tenants,
  truckRequests,
  users,
} from '@arkilaunch/db';
import { notificationEmail, renderEmailHtml, tenantWebOrigin, type EmailBrand, type InvoiceInfo } from '@arkilaunch/shared';


// The invoice a money notification is about, read in the caller's tenant
// transaction (RLS). Null for a notification without an invoice_id.
async function invoiceInfo(tx: Tx, payload: Record<string, unknown>): Promise<InvoiceInfo | null> {
  if (typeof payload.invoice_id !== 'string') return null;
  const [row] = await tx
    .select({
      invoiceId: invoices.id,
      invoiceType: invoices.invoiceType,
      amount: invoices.amount,
      dueDate: invoices.dueDate,
      rentalId: invoices.rentalId,
      truckRequestId: invoices.truckRequestId,
      rentalCode: rentals.code,
      truckCode: truckRequests.code,
    })
    .from(invoices)
    .leftJoin(rentals, eq(rentals.id, invoices.rentalId))
    .leftJoin(truckRequests, eq(truckRequests.id, invoices.truckRequestId))
    .where(eq(invoices.id, payload.invoice_id))
    .limit(1);
  if (!row) return null;
  return {
    invoiceId: row.invoiceId,
    invoiceType: row.invoiceType,
    code: row.rentalCode ?? row.truckCode,
    amountPhp: Number(row.amount),
    dueDate: row.dueDate,
    rentalId: row.rentalId,
    truckRequestId: row.truckRequestId,
  };
}

// The current tenant's storefront branding (RLS tenant_self scopes the row
// to the transaction's tenant) for the email header, and its own web
// origin, which every link in the email must use.
export async function tenantEmailContext(tx: Tx): Promise<{ brand: EmailBrand; origin: string }> {
  const [row] = await tx
    .select({ name: tenants.legalName, slug: tenants.slug, logoKey: tenants.logoKey, color: tenants.primaryColor })
    .from(tenants)
    .limit(1);
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  return {
    brand: { name: row?.name ?? 'ArkiLaunch', logoUrl: publicPhotoUrl(row?.logoKey ?? null), color: row?.color ?? null },
    origin: row ? tenantWebOrigin(row.slug, webOrigin, process.env.PLATFORM_DOMAIN) : webOrigin,
  };
}

// Queues the email for a money event, sent once the transaction commits.
// Users who switched email off in settings (notification_prefs) get none.
async function queueEmails(
  tx: Tx,
  recipients: { email: string; prefs: { email: boolean } }[],
  type: string,
  payload: Record<string, unknown>,
  audience: 'customer' | 'staff',
): Promise<void> {
  const to = recipients.filter((r) => r.prefs.email).map((r) => r.email);
  if (to.length === 0) return;
  const inv = await invoiceInfo(tx, payload);
  if (!inv) return;
  const { brand, origin } = await tenantEmailContext(tx);
  const mail = notificationEmail(type, inv, audience, origin, payload);
  if (!mail) return;
  const html = renderEmailHtml(brand, mail.text);
  for (const address of to) afterCommit(tx, () => sendEmail(address, mail.subject, mail.text, html));
}

// Drops a row into one user's in-app feed (notifications.tsx), plus an
// email for a money event. Runs inside the caller's tenant transaction so
// RLS scopes it.
export async function notifyUser(
  tx: Tx,
  tenantId: string,
  userId: string,
  notificationType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(notifications).values({ tenantId, userId, notificationType, payload });
  const recipients = await tx
    .select({ email: users.email, prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, userId));
  await queueEmails(tx, recipients, notificationType, payload, 'customer');
}

// The booking customer's feed; a customer record with no login
// (customers.user_id null) simply gets nothing.
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
  await notifyUser(tx, tenantId, row.userId, notificationType, { rental_id: rentalId, ...payload });
}

// Staff told about customer requests: admins act on them, and owners see
// their company's bookings and payments too (QA 26), even where only an
// admin can approve.
const STAFF_ALERT_ROLES = ['admin', 'owner'];
// These open admin-only screens (the registration queues, People), which
// an owner's link would bounce off.
const ADMIN_ONLY_ALERTS = new Set(['company_submitted', 'company_reapplied', 'password_reset_requested']);

// Drops a row into every active tenant admin's feed, so a customer's
// booking, counter-offer or request is seen without watching a list.
export async function notifyStaff(
  tx: Tx,
  tenantId: string,
  notificationType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const staff = await tx
    .select({ id: users.id, email: users.email, prefs: users.notificationPrefs })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(inArray(roles.name, ADMIN_ONLY_ALERTS.has(notificationType) ? ['admin'] : STAFF_ALERT_ROLES), eq(users.status, 'active')));
  if (staff.length === 0) return;
  await tx.insert(notifications).values(staff.map((user) => ({ tenantId, userId: user.id, notificationType, payload })));
  await queueEmails(tx, staff, notificationType, payload, 'staff');
}
