import { hash } from '@node-rs/argon2';
import * as schema from '../schema/index.js';
import { makeServiceDb, seedPermissionCatalog } from './permission-catalog.js';

// QAD §3: "A test that 'confirms isolation' against a single-tenant
// database proves nothing." Seeds two tenants, each with an admin user and
// one piece of equipment, so cross-tenant isolation tests have real rows
// on both sides of the boundary to probe.
async function main() {
  const { db, client } = makeServiceDb();
  const { roleIds } = await seedPermissionCatalog(db);
  const adminRoleId = roleIds.get('admin');
  if (!adminRoleId) throw new Error('admin role missing from seeded catalog');

  const [equipmentType] = await db
    .insert(schema.equipmentTypes)
    .values({ name: 'Backhoe Loader' })
    .returning();
  if (!equipmentType) throw new Error('failed to seed equipment_types');

  for (const slug of ['test-tenant-a', 'test-tenant-b']) {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ legalName: `Test Tenant ${slug.slice(-1).toUpperCase()}`, slug, status: 'active' })
      .onConflictDoUpdate({ target: schema.tenants.slug, set: { status: 'active' } })
      .returning();
    if (!tenant) continue;

    const passwordHash = await hash('test-password');
    await db
      .insert(schema.users)
      .values({
        tenantId: tenant.id,
        roleId: adminRoleId,
        email: `admin@${slug}.test`,
        passwordHash,
        status: 'active',
      })
      .onConflictDoNothing();

    await db.insert(schema.equipment).values({
      tenantId: tenant.id,
      equipmentTypeId: equipmentType.id,
      model: `${slug} Excavator`,
      serialNo: `${slug}-serial-001`,
    });
  }

  await client.end();
  console.log('Two-tenant test fixture seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
