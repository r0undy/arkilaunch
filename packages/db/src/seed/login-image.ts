// Sample sign-in splash photo for the Almara tenant (dev only).
// Photo: "Caterpillar 330 excavator on a pile of dirt" by Matthew T Rader,
// CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:Caterpillar_330_excavator_on_a_pile_of_dirt.jpg
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { makeServiceDb } from './permission-catalog.js';

async function main() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';
  if (!base || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const { db, client } = makeServiceDb();
  try {
    const rows = await db.execute<{ id: string }>(sql`select id from tenants where slug = 'almara'`);
    const tenantId = rows[0]?.id;
    if (!tenantId) throw new Error('Almara tenant not found; run seed:anchor first');

    const key = `${tenantId}/branding/login-sample.jpg`;
    const res = await fetch(`${base}/storage/v1/object/${bucket}/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: readFileSync(new URL('./assets/almara-login.jpg', import.meta.url)),
    });
    if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);

    await db.execute(sql`update tenants set login_key = ${key} where id = ${tenantId}`);
    console.log(`Almara sign-in image set: ${base}/storage/v1/object/public/${bucket}/${key}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
