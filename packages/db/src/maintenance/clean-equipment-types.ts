import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { config } from 'dotenv';
import postgres from 'postgres';
import { planEquipmentTypeCleanup } from './equipment-type-cleanup.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
config({ path: resolve(repoRoot, '.env'), quiet: true });
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply'))
  throw new Error('Usage: cleanup:equipment-types [--apply]');
const apply = args.includes('--apply');
const connectionString = process.env.DATABASE_URL_DIRECT;
if (!connectionString) throw new Error('DATABASE_URL_DIRECT is required');
const db = postgres(connectionString, { max: 1, prepare: false, connect_timeout: 10 });
const tables = ['equipment_types', 'equipment', 'rate_cards', 'quotation_items'] as const;
type Row = Record<string, unknown>;
function digest(rows: Row[]): string {
  return createHash('sha256')
    .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort()))
    .digest('hex');
}
let backupFile: string | null = null;
let committed = false;
try {
  const result = await db.begin(apply ? '' : 'read only', async (tx) => {
    const [role] = await tx<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    if (!role || (!role.rolsuper && !role.rolbypassrls))
      throw new Error('Cleanup requires an administrative connection with full tenant visibility');
    const cascadingKeys =
      await tx`select conname from pg_constraint where contype = 'f' and confrelid in ('public.equipment_types'::regclass, 'public.rate_cards'::regclass) and confdeltype not in ('a', 'r')`;
    if (cascadingKeys.length) throw new Error('Unexpected cascading foreign key; cleanup refused');
    if (apply) {
      await tx`set local lock_timeout = '10s'`;
      await tx`set local statement_timeout = '120s'`;
      await tx`lock table public.equipment_types, public.equipment, public.rate_cards, public.quotation_items in access exclusive mode`;
    }
    const types = await tx<{ id: string; name: string }[]>`select * from public.equipment_types`;
    const equipment = await tx<
      (Row & { id: string; equipment_type_id: string })[]
    >`select * from public.equipment`;
    const rates = await tx<
      (Row & { id: string; equipment_type_id: string })[]
    >`select * from public.rate_cards`;
    const items = await tx<
      (Row & { equipment_type_id: string | null; rate_card_id: string | null })[]
    >`select * from public.quotation_items`;
    const plan = planEquipmentTypeCleanup(types, rates, items);
    const targetIds = new Set(plan.typeIds);
    const affectedEquipment = equipment.filter((row) => targetIds.has(row.equipment_type_id));
    const preview = {
      mode: apply ? 'apply' : 'preview',
      targetHost: new URL(connectionString).hostname,
      fixtureCategories: types
        .filter((row) => targetIds.has(row.id))
        .map((row) => row.name)
        .sort(),
      categoryCount: plan.typeIds.length,
      equipmentToReclassify: affectedEquipment.length,
      equipmentToPreserve: equipment.length,
      unusedFixtureRateCards: plan.rateIds.length,
      categoriesToKeep: types
        .filter((row) => !targetIds.has(row.id))
        .map((row) => row.name)
        .sort(),
    };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply || plan.typeIds.length === 0)
      return {
        changed: false,
        categoryCount: plan.typeIds.length,
        preservedEquipment: equipment.length,
      };
    const backup = {
      createdAt: new Date().toISOString(),
      preview,
      plan,
      tables: { equipment_types: types, equipment, rate_cards: rates, quotation_items: items },
    };
    const backupDir = resolve(repoRoot, '.git', 'codex-backups');
    mkdirSync(backupDir, { recursive: true });
    backupFile = resolve(backupDir, 'equipment-categories-' + Date.now() + '.json.gz');
    const backupText = JSON.stringify(backup);
    writeFileSync(backupFile, gzipSync(backupText), { flag: 'wx' });
    if (gunzipSync(readFileSync(backupFile)).toString() !== backupText)
      throw new Error('Backup verification failed');
    const updated =
      await tx`update public.equipment set equipment_type_id = ${plan.fallbackId} where equipment_type_id = any(${plan.typeIds}::uuid[]) returning id`;
    const deletedRates =
      await tx`delete from public.rate_cards where equipment_type_id = any(${plan.typeIds}::uuid[]) returning id`;
    const deletedTypes =
      await tx`delete from public.equipment_types where id = any(${plan.typeIds}::uuid[]) returning id`;
    if (
      updated.length !== affectedEquipment.length ||
      deletedRates.length !== plan.rateIds.length ||
      deletedTypes.length !== plan.typeIds.length
    )
      throw new Error('Mutation counts differ from the locked preview');
    const expected: Record<(typeof tables)[number], Row[]> = {
      equipment_types: types.filter((row) => !targetIds.has(row.id)),
      equipment: equipment.map((row) =>
        targetIds.has(row.equipment_type_id) ? { ...row, equipment_type_id: plan.fallbackId } : row,
      ),
      rate_cards: rates.filter((row) => !targetIds.has(row.equipment_type_id)),
      quotation_items: items,
    };
    for (const table of tables) {
      const actual = await tx<Row[]>`select * from ${tx('public.' + table)}`;
      if (digest(actual) !== digest(expected[table]))
        throw new Error('Post-cleanup verification failed: ' + table);
    }
    return {
      changed: true,
      removedCategories: deletedTypes.length,
      reclassifiedEquipment: updated.length,
      removedUnusedRates: deletedRates.length,
      preservedEquipment: equipment.length,
      remainingCategories: types.length - deletedTypes.length,
      backupFile,
    };
  });
  committed = apply;
  console.log(JSON.stringify({ status: apply ? 'committed' : 'preview-only', ...result }, null, 2));
  if (apply && backupFile)
    writeFileSync(
      backupFile + '.result.json',
      JSON.stringify({ status: 'committed', ...result }, null, 2),
    );
} catch (error) {
  console.error(
    JSON.stringify({
      status: committed ? 'committed-report-failed' : 'failed-no-changes',
      error: error instanceof Error ? error.message : 'Cleanup failed',
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
