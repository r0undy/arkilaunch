-- Hand-authored. Standard heavy-equipment categories as used on Philippine
-- construction sites (DPWH equipment classes and the common rental-yard
-- names; "Payloader" is the local name for a wheel loader).
--
-- equipment_types is platform-global reference data (0016). This migration:
--   1. inserts the standard list,
--   2. folds the older 0035 names and duplicate rows into one row per name,
--      re-pointing equipment, rate_cards and quotation_items first (paired
--      backfill, so no reference is lost),
--   3. deletes type rows nothing references that are not standard (test
--      fixtures, the folded duplicates),
--   4. adds a unique index on name so duplicates cannot come back.

-- 1. The standard list.
INSERT INTO "equipment_types" ("name")
SELECT v.name FROM (VALUES
  ('Excavator'), ('Mini Excavator'), ('Backhoe Loader'), ('Wheel Loader (Payloader)'),
  ('Skid Steer Loader'), ('Bulldozer'), ('Motor Grader'), ('Road Roller'),
  ('Pneumatic Tire Roller'), ('Plate Compactor'), ('Asphalt Paver'), ('Dump Truck'),
  ('Water Truck'), ('Boom Truck'), ('Mobile Crane'), ('Crawler Crane'), ('Forklift'),
  ('Transit Mixer'), ('Concrete Pump'), ('Generator Set'), ('Air Compressor'),
  ('Boom Lift (Manlift)'), ('Others')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "equipment_types" t WHERE t.name = v.name);--> statement-breakpoint

-- 2. Every row -> the canonical row for its (renamed) name.
CREATE TEMP TABLE "type_fold" AS
WITH renamed AS (
  SELECT t.id, COALESCE(m.new_name, t.name) AS name
  FROM "equipment_types" t
  LEFT JOIN (VALUES
    ('Wheel Loader', 'Wheel Loader (Payloader)'),
    ('Skid Steer', 'Skid Steer Loader'),
    ('Crane', 'Mobile Crane'),
    ('Concrete Mixer', 'Transit Mixer'),
    ('Generator', 'Generator Set'),
    ('Boom Lift', 'Boom Lift (Manlift)')
  ) AS m(old_name, new_name) ON m.old_name = t.name
), canonical AS (
  -- Prefer the row already carrying the final name, then the lowest id.
  SELECT DISTINCT ON (r.name) r.name, r.id AS keep_id
  FROM renamed r JOIN "equipment_types" t ON t.id = r.id
  ORDER BY r.name, (t.name <> r.name), r.id
)
SELECT r.id AS old_id, c.keep_id
FROM renamed r JOIN canonical c ON c.name = r.name
WHERE r.id <> c.keep_id;--> statement-breakpoint

UPDATE "equipment" e SET "equipment_type_id" = f.keep_id
FROM "type_fold" f WHERE e."equipment_type_id" = f.old_id;--> statement-breakpoint
UPDATE "rate_cards" r SET "equipment_type_id" = f.keep_id
FROM "type_fold" f WHERE r."equipment_type_id" = f.old_id;--> statement-breakpoint
UPDATE "quotation_items" q SET "equipment_type_id" = f.keep_id
FROM "type_fold" f WHERE q."equipment_type_id" = f.old_id;--> statement-breakpoint
DELETE FROM "equipment_types" t USING "type_fold" f WHERE t.id = f.old_id;--> statement-breakpoint
DROP TABLE "type_fold";--> statement-breakpoint

-- Old 0035 names that were the only row for their name: rename in place.
UPDATE "equipment_types" t SET "name" = m.new_name
FROM (VALUES
  ('Wheel Loader', 'Wheel Loader (Payloader)'),
  ('Skid Steer', 'Skid Steer Loader'),
  ('Crane', 'Mobile Crane'),
  ('Concrete Mixer', 'Transit Mixer'),
  ('Generator', 'Generator Set'),
  ('Boom Lift', 'Boom Lift (Manlift)')
) AS m(old_name, new_name)
WHERE t.name = m.old_name
  AND NOT EXISTS (SELECT 1 FROM "equipment_types" x WHERE x.name = m.new_name);--> statement-breakpoint

-- 3. Unreferenced, non-standard rows (test fixtures and leftovers).
DELETE FROM "equipment_types" t
WHERE t.name NOT IN (
  'Excavator', 'Mini Excavator', 'Backhoe Loader', 'Wheel Loader (Payloader)',
  'Skid Steer Loader', 'Bulldozer', 'Motor Grader', 'Road Roller',
  'Pneumatic Tire Roller', 'Plate Compactor', 'Asphalt Paver', 'Dump Truck',
  'Water Truck', 'Boom Truck', 'Mobile Crane', 'Crawler Crane', 'Forklift',
  'Transit Mixer', 'Concrete Pump', 'Generator Set', 'Air Compressor',
  'Boom Lift (Manlift)', 'Others'
)
AND NOT EXISTS (SELECT 1 FROM "equipment" e WHERE e."equipment_type_id" = t.id)
AND NOT EXISTS (SELECT 1 FROM "rate_cards" r WHERE r."equipment_type_id" = t.id)
AND NOT EXISTS (SELECT 1 FROM "quotation_items" q WHERE q."equipment_type_id" = t.id);--> statement-breakpoint

-- 4. One row per name from here on.
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_types_name_unique" ON "equipment_types" ("name");
