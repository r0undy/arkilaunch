-- Hand-authored (CR: cr-arkilaunch-uniform-booking-codes.md).
--
-- One booking reference, the same shape for both services: EQR-2026-0001 for
-- an equipment rental, TRK-2026-0001 for a truck service. Until now a
-- "booking code" was four hex characters of the UUID, drawn on screen only:
-- not unique, not searchable, and the same rental read BKG- on one screen and
-- RNT- on the next.
--
-- The code is assigned by a BEFORE INSERT trigger, not by the service layer,
-- so every insert path (API, seeds, fixtures, a future job) gets one and none
-- can forget it. The counter row is taken with INSERT .. ON CONFLICT DO UPDATE,
-- which row-locks it for the rest of the transaction, so concurrent bookings
-- in one tenant serialise on the counter and never share a number. A rolled
-- back booking leaves a gap: this is a reference, not a fiscal number.
--
-- The year is the Asia/Manila calendar year of created_at, so a booking made
-- at 07:30 on 1 January Manila time is not filed under the previous year.
-- The number is zero-padded to at least four digits and never truncated
-- (lpad alone would cut 10000 to "1000").
CREATE TABLE IF NOT EXISTS "booking_code_counters" (
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"service" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "booking_code_counters_pk" PRIMARY KEY ("tenant_id", "service", "year"),
	CONSTRAINT "booking_code_counters_service_chk" CHECK ("service" IN ('rental', 'truck')),
	CONSTRAINT "booking_code_counters_value_chk" CHECK ("last_value" > 0)
);--> statement-breakpoint
ALTER TABLE "booking_code_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booking_code_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "booking_code_counters";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_code_counters" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "booking_code_counters" TO app_authenticated;--> statement-breakpoint

ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "code" text;--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "code" text;--> statement-breakpoint

CREATE OR REPLACE FUNCTION booking_code_format(prefix text, yr integer, n integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT prefix || '-' || yr::text || '-' || lpad(n::text, GREATEST(4, length(n::text)), '0')
$$;--> statement-breakpoint

-- SECURITY INVOKER on purpose: on a request path the counter write runs as
-- app_authenticated under the same tenant GUC as the booking row itself, so
-- RLS keeps one tenant from ever touching another's counter.
CREATE OR REPLACE FUNCTION booking_code_assign() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  svc text := CASE TG_TABLE_NAME WHEN 'rentals' THEN 'rental' ELSE 'truck' END;
  prefix text := CASE TG_TABLE_NAME WHEN 'rentals' THEN 'EQR' ELSE 'TRK' END;
  yr integer := EXTRACT(YEAR FROM (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Manila'))::integer;
  n integer;
BEGIN
  IF NEW.code IS NOT NULL THEN
    RAISE EXCEPTION 'booking code is assigned by the database, not supplied (got %)', NEW.code
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO booking_code_counters AS c (tenant_id, service, year, last_value)
  VALUES (NEW.tenant_id, svc, yr, 1)
  ON CONFLICT (tenant_id, service, year) DO UPDATE SET last_value = c.last_value + 1
  RETURNING c.last_value INTO n;
  NEW.code := booking_code_format(prefix, yr, n);
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION booking_code_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'booking code % cannot be changed', OLD.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Backfill before the triggers exist: every existing row, per tenant and
-- Manila year, numbered in creation order (id breaks ties so a re-run of the
-- same data numbers it the same way).
WITH numbered AS (
  SELECT id, tenant_id,
         EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Manila'))::integer AS yr,
         row_number() OVER (
           PARTITION BY tenant_id, EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Manila'))
           ORDER BY created_at, id
         )::integer AS n
  FROM rentals WHERE code IS NULL
)
UPDATE rentals r SET code = booking_code_format('EQR', numbered.yr, numbered.n)
FROM numbered WHERE r.id = numbered.id;--> statement-breakpoint
WITH numbered AS (
  SELECT id, tenant_id,
         EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Manila'))::integer AS yr,
         row_number() OVER (
           PARTITION BY tenant_id, EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Manila'))
           ORDER BY created_at, id
         )::integer AS n
  FROM truck_requests WHERE code IS NULL
)
UPDATE truck_requests t SET code = booking_code_format('TRK', numbered.yr, numbered.n)
FROM numbered WHERE t.id = numbered.id;--> statement-breakpoint

-- Seed the counters from the backfill so the next booking continues the
-- sequence instead of colliding with number 1.
INSERT INTO booking_code_counters (tenant_id, service, year, last_value)
SELECT tenant_id, 'rental', split_part(code, '-', 2)::integer, max(split_part(code, '-', 3)::integer)
FROM rentals GROUP BY tenant_id, split_part(code, '-', 2)
ON CONFLICT (tenant_id, service, year) DO UPDATE SET last_value = GREATEST(booking_code_counters.last_value, EXCLUDED.last_value);--> statement-breakpoint
INSERT INTO booking_code_counters (tenant_id, service, year, last_value)
SELECT tenant_id, 'truck', split_part(code, '-', 2)::integer, max(split_part(code, '-', 3)::integer)
FROM truck_requests GROUP BY tenant_id, split_part(code, '-', 2)
ON CONFLICT (tenant_id, service, year) DO UPDATE SET last_value = GREATEST(booking_code_counters.last_value, EXCLUDED.last_value);--> statement-breakpoint

ALTER TABLE "rentals" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_requests" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" DROP CONSTRAINT IF EXISTS "rentals_code_chk";--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_code_chk" CHECK ("code" ~ '^EQR-[0-9]{4}-[0-9]{4,}$');--> statement-breakpoint
ALTER TABLE "truck_requests" DROP CONSTRAINT IF EXISTS "truck_requests_code_chk";--> statement-breakpoint
ALTER TABLE "truck_requests" ADD CONSTRAINT "truck_requests_code_chk" CHECK ("code" ~ '^TRK-[0-9]{4}-[0-9]{4,}$');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rentals_tenant_code_uq" ON "rentals" ("tenant_id", "code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "truck_requests_tenant_code_uq" ON "truck_requests" ("tenant_id", "code");--> statement-breakpoint

DROP TRIGGER IF EXISTS "rentals_booking_code" ON "rentals";--> statement-breakpoint
CREATE TRIGGER "rentals_booking_code" BEFORE INSERT ON "rentals" FOR EACH ROW EXECUTE FUNCTION booking_code_assign();--> statement-breakpoint
DROP TRIGGER IF EXISTS "truck_requests_booking_code" ON "truck_requests";--> statement-breakpoint
CREATE TRIGGER "truck_requests_booking_code" BEFORE INSERT ON "truck_requests" FOR EACH ROW EXECUTE FUNCTION booking_code_assign();--> statement-breakpoint
DROP TRIGGER IF EXISTS "rentals_booking_code_immutable" ON "rentals";--> statement-breakpoint
CREATE TRIGGER "rentals_booking_code_immutable" BEFORE UPDATE OF "code" ON "rentals" FOR EACH ROW EXECUTE FUNCTION booking_code_immutable();--> statement-breakpoint
DROP TRIGGER IF EXISTS "truck_requests_booking_code_immutable" ON "truck_requests";--> statement-breakpoint
CREATE TRIGGER "truck_requests_booking_code_immutable" BEFORE UPDATE OF "code" ON "truck_requests" FOR EACH ROW EXECUTE FUNCTION booking_code_immutable();
--> statement-breakpoint

-- Every notification that names a booking -- by rental_id, truck_request_id,
-- or (payments) the invoice_id standing in for the booking it bills -- gets
-- the booking code and the booking's id in its payload, so the feed can say
-- "EQR-2026-0001" and link to it. Done here rather than in each writer: the
-- API, the jobs and packages/db all insert notifications, and one trigger
-- cannot be forgotten by the next writer. A payload that already carries
-- booking_code, or names no booking, is left exactly as written.
CREATE OR REPLACE FUNCTION uuid_or_null(v text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN v::uuid END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION notification_booking_ref() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p jsonb := NEW.payload;
  rid uuid;
  tid uuid;
  c text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR p ? 'booking_code' THEN
    RETURN NEW;
  END IF;
  rid := uuid_or_null(p->>'rental_id');
  tid := uuid_or_null(p->>'truck_request_id');
  IF rid IS NULL AND tid IS NULL AND uuid_or_null(p->>'invoice_id') IS NOT NULL THEN
    SELECT i.rental_id, i.truck_request_id INTO rid, tid FROM invoices i WHERE i.id = uuid_or_null(p->>'invoice_id');
  END IF;
  IF rid IS NOT NULL THEN
    SELECT r.code INTO c FROM rentals r WHERE r.id = rid;
    IF c IS NOT NULL THEN
      NEW.payload := p || jsonb_build_object('booking_code', c, 'booking_service', 'rental', 'rental_id', rid::text);
    END IF;
  ELSIF tid IS NOT NULL THEN
    SELECT t.code INTO c FROM truck_requests t WHERE t.id = tid;
    IF c IS NOT NULL THEN
      NEW.payload := p || jsonb_build_object('booking_code', c, 'booking_service', 'truck', 'truck_request_id', tid::text);
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "notifications_booking_ref" ON "notifications";--> statement-breakpoint
CREATE TRIGGER "notifications_booking_ref" BEFORE INSERT ON "notifications" FOR EACH ROW EXECUTE FUNCTION notification_booking_ref();--> statement-breakpoint

-- Existing rows, so the feed is uniform from the first deploy. uuid_or_null
-- keeps a malformed legacy payload from aborting the migration.
UPDATE notifications n SET payload = n.payload || jsonb_build_object('booking_code', r.code, 'booking_service', 'rental')
FROM rentals r
WHERE jsonb_typeof(n.payload) = 'object' AND NOT n.payload ? 'booking_code'
  AND r.id = uuid_or_null(n.payload->>'rental_id');--> statement-breakpoint
UPDATE notifications n SET payload = n.payload || jsonb_build_object('booking_code', t.code, 'booking_service', 'truck')
FROM truck_requests t
WHERE jsonb_typeof(n.payload) = 'object' AND NOT n.payload ? 'booking_code'
  AND t.id = uuid_or_null(n.payload->>'truck_request_id');--> statement-breakpoint
UPDATE notifications n SET payload = n.payload || jsonb_strip_nulls(jsonb_build_object(
    'booking_code', COALESCE(r.code, t.code),
    'booking_service', CASE WHEN r.code IS NOT NULL THEN 'rental' ELSE 'truck' END,
    'rental_id', i.rental_id::text,
    'truck_request_id', i.truck_request_id::text))
FROM invoices i
LEFT JOIN rentals r ON r.id = i.rental_id
LEFT JOIN truck_requests t ON t.id = i.truck_request_id
WHERE jsonb_typeof(n.payload) = 'object' AND NOT n.payload ? 'booking_code'
  AND i.id = uuid_or_null(n.payload->>'invoice_id')
  AND COALESCE(r.code, t.code) IS NOT NULL;
