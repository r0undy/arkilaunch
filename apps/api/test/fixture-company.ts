import type postgres from 'postgres';

// The seeded customer owns several companies on the shared DB, so bookings must name one explicitly.
export async function fixtureCompanyId(sql: postgres.Sql, tenantId: string): Promise<string> {
  const [row] = await sql`
    select c.id from customers c
    join users u on u.id = c.user_id
    where c.tenant_id = ${tenantId} and u.email = 'customer@test-tenant-a.test'
      and c.company_name = 'test-tenant-a Customer Co.'
  `;
  if (!row) throw new Error('seeded company test-tenant-a Customer Co. is missing; run seed:test-two-tenant');
  return (row as { id: string }).id;
}
