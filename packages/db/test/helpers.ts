import postgres from 'postgres';

// Test-only helpers. Tests run against the real Supabase project named in
// DATABASE_URL_DIRECT / DATABASE_URL_POOLED -- the two-tenant fixture from
// `pnpm db:seed:test` must already be applied (QAD §3: "a test that
// 'confirms isolation' against a single-tenant database proves nothing").

export function directSql() {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error('DATABASE_URL_DIRECT is required to run packages/db tests');
  return postgres(url, { max: 1 });
}

export function pooledSql() {
  const url = process.env.DATABASE_URL_POOLED;
  if (!url) throw new Error('DATABASE_URL_POOLED is required to run packages/db tests');
  return postgres(url, { max: 1, prepare: false });
}

export async function getTenantId(sql: ReturnType<typeof directSql>, slug: string): Promise<string> {
  const rows = await sql`select id from tenants where slug = ${slug}`;
  const row = rows[0] as { id: string } | undefined;
  if (!row) throw new Error(`fixture tenant "${slug}" not found -- run pnpm db:seed:test first`);
  return row.id;
}

export async function setTenantGuc(
  sql: ReturnType<typeof pooledSql>,
  tenantId: string | null,
): Promise<void> {
  await sql`select set_config('app.current_tenant_id', ${tenantId}, false)`;
}
