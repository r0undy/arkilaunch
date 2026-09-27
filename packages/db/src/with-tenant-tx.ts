import { sql } from 'drizzle-orm';
import type { RequestContext } from '@arkilaunch/shared';
import { db } from './client.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Side effects (emails) queued by code running inside a withTenantTx, run
// only once it commits: a rolled-back payment never mails "you paid".
const pending = new WeakMap<object, (() => Promise<void>)[]>();

export function afterCommit(tx: Tx, fn: () => Promise<void>): void {
  const queue = pending.get(tx);
  // Every notify path runs inside withTenantTx; anything else is a bug,
  // and dropping the email silently would hide it.
  if (!queue) throw new Error('afterCommit called outside withTenantTx');
  queue.push(fn);
}

// Every request runs inside a transaction that sets the tenant/user/role
// GUCs BEFORE any query, so Postgres RLS filters rows. local=true binds the
// GUC to the transaction, so a pooled (Supavisor) connection cannot leak
// tenant context across requests. RLS is the backstop; never rely on an
// app-level `where tenant_id = ?` alone (AGENTS.md §4 golden path).
export async function withTenantTx<T>(
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const queue: (() => Promise<void>)[] = [];
  const result = await db.transaction(async (tx) => {
    pending.set(tx, queue);
    await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.tenantId}, true)`);
    await tx.execute(sql`select set_config('app.current_user_id',  ${ctx.userId},   true)`);
    await tx.execute(sql`select set_config('app.current_role',     ${ctx.role},     true)`);
    return fn(tx);
  });
  // Committed. A failed email must not fail the request (or a webhook's
  // 2xx, which would make PayMongo redeliver an already-settled event).
  for (const run of queue) {
    await run().catch((err) => console.error('[afterCommit]', err));
  }
  return result;
}
