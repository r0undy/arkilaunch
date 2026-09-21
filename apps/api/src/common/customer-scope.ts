import { eq } from 'drizzle-orm';
import { customers, db } from '@arkilaunch/db';
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
