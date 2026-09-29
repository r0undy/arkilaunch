ALTER TABLE truck_requests ADD COLUMN route_cities jsonb;--> statement-breakpoint
ALTER TABLE truck_requests ADD COLUMN route_minutes integer;--> statement-breakpoint
ALTER TABLE truck_requests ADD COLUMN dispatched_at timestamptz;--> statement-breakpoint
ALTER TABLE truck_requests ADD COLUMN eta_at timestamptz;--> statement-breakpoint
ALTER TABLE truck_requests DROP CONSTRAINT truck_requests_status_valid;--> statement-breakpoint
ALTER TABLE truck_requests ADD CONSTRAINT truck_requests_status_valid
  CHECK (status IN ('estimated','km_confirmed','agreed','paid','dispatched','cancelled'));--> statement-breakpoint

CREATE TABLE truck_ban_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  city text NOT NULL,
  province text NOT NULL,
  days integer[] NOT NULL,
  windows jsonb NOT NULL,
  min_gvw_kg integer,
  permit_note text NOT NULL DEFAULT '',
  verified boolean NOT NULL DEFAULT false,
  CONSTRAINT truck_ban_rules_days_valid CHECK (cardinality(days) > 0 AND days <@ ARRAY[0,1,2,3,4,5,6]),
  CONSTRAINT truck_ban_rules_min_gvw_valid CHECK (min_gvw_kg IS NULL OR min_gvw_kg > 0)
);--> statement-breakpoint
CREATE INDEX truck_ban_rules_tenant_id_idx ON truck_ban_rules(tenant_id);--> statement-breakpoint
CREATE UNIQUE INDEX truck_ban_rules_tenant_city_province_key ON truck_ban_rules(tenant_id, city, province);--> statement-breakpoint
ALTER TABLE truck_ban_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE truck_ban_rules FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON truck_ban_rules AS PERMISSIVE FOR ALL TO app_authenticated
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON truck_ban_rules TO app_authenticated;--> statement-breakpoint

-- Starting examples for every existing and future tenant. Citywide coverage
-- and hours must be checked by staff against current MMDA/LGU road rules.
CREATE FUNCTION seed_metro_manila_truck_bans(p_tenant_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.truck_ban_rules (tenant_id, city, province, days, windows, min_gvw_kg, permit_note, verified)
  SELECT p_tenant_id, city, 'Metro Manila', ARRAY[1,2,3,4,5,6],
    '[{"from":"06:00","to":"10:00"},{"from":"17:00","to":"22:00"}]'::jsonb,
    NULL, 'Check the current MMDA and city road restrictions before dispatch; permit or reschedule where required.', false
  FROM unnest(ARRAY['Caloocan','Las Piñas','Makati','Malabon','Mandaluyong','Manila','Marikina',
    'Muntinlupa','Navotas','Parañaque','Pasay','Pasig','Pateros','Quezon City','San Juan',
    'Taguig','Valenzuela']) AS city
  ON CONFLICT (tenant_id, city, province) DO NOTHING;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION seed_metro_manila_truck_bans(uuid) FROM PUBLIC;--> statement-breakpoint
SELECT seed_metro_manila_truck_bans(id) FROM public.tenants;--> statement-breakpoint
CREATE FUNCTION seed_new_tenant_truck_bans() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.seed_metro_manila_truck_bans(NEW.id);
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION seed_new_tenant_truck_bans() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER seed_new_tenant_truck_bans AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION seed_new_tenant_truck_bans();
