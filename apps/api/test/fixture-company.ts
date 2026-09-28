import type postgres from 'postgres';

// The seeded test-tenant-a customer login owns more than one company once
// other specs (and hand QA on the shared database) add theirs, and
// bookings.create() then refuses an implicit pick with 409
// company_required. Specs that book as that customer name the seeded
// company explicitly instead of depending on it being the only one.
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
