import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { customers, db, invoices, rentals, truckRequests } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The caller's OWN `customers` rows for a `customer`-role caller: one login
// may own several companies (customer prerequisites CR), each a customers
// row sharing user_id. Never trusts a client-supplied customerId for that
// role (mirrors the timekeeper site-scope check in edtr.service.ts).
//
// `customer` is an intra-tenant role, so RLS scopes it to the tenant but
// never to the customer. Every read of a customer-owned row therefore
// needs this predicate on top of RLS, or one customer reads another's
// pricing (audit-api-surface.md #1).
export async function ownCustomers(tx: Tx, ctx: RequestContext) {
  return tx.select().from(customers).where(eq(customers.userId, ctx.userId));
}

export async function ownsCustomer(tx: Tx, ctx: RequestContext, customerId: string | null): Promise<boolean> {
  if (!customerId) return false;
  return (await ownCustomers(tx, ctx)).some((row) => row.id === customerId);
}

// A customer's own invoice: one on their booking (via ownsCustomer) or on
// their own truck request. Anything else reads as not found.
export async function customerOwnsInvoice(
  tx: Tx,
  ctx: RequestContext,
  invoice: typeof invoices.$inferSelect,
): Promise<boolean> {
  if (invoice.truckRequestId) {
    const [request] = await tx
      .select({ requestedBy: truckRequests.requestedBy })
      .from(truckRequests)
      .where(eq(truckRequests.id, invoice.truckRequestId))
      .limit(1);
    return request?.requestedBy === ctx.userId;
  }
  if (!invoice.rentalId) return false;
  const [rental] = await tx
    .select({ customerId: rentals.customerId })
    .from(rentals)
    .where(eq(rentals.id, invoice.rentalId))
    .limit(1);
  return rental ? ownsCustomer(tx, ctx, rental.customerId) : false;
}

// Only an approved company can book or be quoted, not just check out.
// Same 409 body as PaymentsService.checkout().
export async function requireVerifiedCompany(tx: Tx, customerId: string): Promise<void> {
  const [company] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (company?.kycStatus !== 'approved') {
    throw new ConflictException({ error: 'company_not_verified', status: company?.kycStatus ?? null });
  }
}
