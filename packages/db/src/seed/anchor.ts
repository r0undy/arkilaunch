import { hash } from '@node-rs/argon2';
import * as schema from '../schema/index.js';
import { makeServiceDb, seedPermissionCatalog } from './permission-catalog.js';

// Loading dotenv happens in permission-catalog.js (imported above), which
// every seed entrypoint already imports.

// Seeds Almara Construction as the anchor tenant (PRD, README). Idempotent.
async function main() {
  const { db, client } = makeServiceDb();
  const { roleIds } = await seedPermissionCatalog(db);

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      legalName: 'Almara Construction',
      slug: 'almara',
      status: 'active',
      kycState: 'verified',
    })
    .onConflictDoUpdate({ target: schema.tenants.slug, set: { status: 'active' } })
    .returning();

  const adminRoleId = roleIds.get('admin');
  if (tenant && adminRoleId) {
    const passwordHash = await hash('changeme-dev-only');
    await db
      .insert(schema.users)
      .values({
        tenantId: tenant.id,
        roleId: adminRoleId,
        email: 'admin@almara.test',
        passwordHash,
        status: 'active',
      })
      .onConflictDoNothing();
  }

  await client.end();
  console.log('Anchor tenant seeded: Almara Construction.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
