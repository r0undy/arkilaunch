import { eq } from 'drizzle-orm';
import { getTenantTin, tenants, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import type { StatementBrand } from '../billing/statement-pdf.js';

// The letterhead every generated PDF prints.
export async function tenantBrand(ctx: RequestContext): Promise<StatementBrand> {
  const [tenant] = await withTenantTx(ctx, (tx) => tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1));
  return {
    name: tenant?.legalName ?? '',
    address: [tenant?.address, tenant?.city, tenant?.province].filter(Boolean).join(', '),
    contact: [tenant?.phone, tenant?.contactEmail].filter(Boolean).join(' | '),
    tin: await getTenantTin(ctx.tenantId).catch(() => null),
  };
}
