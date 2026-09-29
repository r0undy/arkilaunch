import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { RequestContext } from '@arkilaunch/shared';
import { db } from './client.js';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Executor = PgDatabase<any, any, any>;

// Side effects (emails) queued by code running inside a withTenantTx, run
// only once it commits: a rolled-back payment never mails "you paid".
const pending = new WeakMap<object, (() => Promise<void>)[]>();

export function afterCommit(tx: Tx, fn: () => Promise<void>): void {
  const queue = pending.get(tx);
  // Every notify path runs inside withTenantTx; silently dropping the email would hide a bug.
  if (!queue) throw new Error('afterCommit called outside withTenantTx');
  queue.push(fn);
}

// Sets the tenant/user/role GUCs BEFORE any query so RLS filters rows. local=true binds them
// to the transaction, so a pooled connection cannot leak tenant context. RLS is the backstop.
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
  // Committed. A failed email must not fail the request, or PayMongo redelivers the webhook.
  for (const run of queue) {
    await run().catch((err) => console.error('[afterCommit]', err));
  }
  return result;
}
