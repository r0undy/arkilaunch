import { count, type SQL } from 'drizzle-orm';
import type { Tx } from '@arkilaunch/db';

type Selectable = Parameters<ReturnType<Tx['select']>['from']>[0];

// Call inside the same withTenantTx as the paged query, so RLS scopes the count like the page.
export async function countRows(tx: Tx, table: Selectable, where?: SQL): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}
