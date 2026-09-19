import { eq } from 'drizzle-orm';
import { customers, db } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Resolves the caller's OWN `customers` row for a `customer`-role caller.
// Never trusts a client-supplied customerId for that role (mirrors the
// timekeeper site-scope check in edtr.service.ts).
//
// Shared by bookings.service.ts (PRD-F8) and quotes.service.ts (RFC-3):
// `customer` is an intra-tenant role, so RLS scopes it to the tenant but
// never to the customer. Every read of a customer-owned row therefore
// needs this predicate on top of RLS, or one customer reads another's
// pricing (audit-api-surface.md #1).
export async function ownCustomer(tx: Tx, ctx: RequestContext) {
  const [row] = await tx.select().from(customers).where(eq(customers.userId, ctx.userId)).limit(1);
  return row ?? null;
}
