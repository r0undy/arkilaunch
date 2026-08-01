import { sql } from 'drizzle-orm';
import type { RequestContext } from '@arkilaunch/shared';
import { db } from './client.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every request runs inside a transaction that sets the tenant/user/role
// GUCs BEFORE any query, so Postgres RLS filters rows. local=true binds the
// GUC to the transaction, so a pooled (Supavisor) connection cannot leak
// tenant context across requests. RLS is the backstop; never rely on an
// app-level `where tenant_id = ?` alone (AGENTS.md §4 golden path).
export async function withTenantTx<T>(
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.tenantId}, true)`);
    await tx.execute(sql`select set_config('app.current_user_id',  ${ctx.userId},   true)`);
    await tx.execute(sql`select set_config('app.current_role',     ${ctx.role},     true)`);
    return fn(tx);
  });
}
