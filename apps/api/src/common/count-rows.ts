import { count, type SQL } from 'drizzle-orm';
import { db } from '@arkilaunch/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Selectable = Parameters<ReturnType<Tx['select']>['from']>[0];

// The unpaged total for a paged list.
//
// Every list in this API used to compute its total by SELECTing every
// matching row and taking `.length` -- a tenant with 100k invoices loaded
// 100k full rows into Node to render a page of 50, defeating the very cap
// the paged query applies (audit-api-surface.md #9). `count(*)` is the
// missing piece; the counting happens in Postgres.
//
// Call inside the same withTenantTx as the paged query, so RLS scopes the
// count to the same tenant as the page it describes.
export async function countRows(tx: Tx, table: Selectable, where?: SQL): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}
