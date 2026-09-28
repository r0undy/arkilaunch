-- Hand-authored, expand-only (CR: cr-arkilaunch-qa-batch-14-22.md). Columns
-- on tables that already carry tenant_id and their RLS policy; no new table.
--
-- 1. A self-loading trip is booked for a company, not a site: the site is an
-- optional drop-off shortcut and no longer needs its proof. Backfilled from
-- the site each pre-0067 request named (a request with no site keeps NULL;
-- checkout then falls back to the requester's approved company).
ALTER TABLE "truck_requests" ADD COLUMN "customer_id" uuid REFERENCES "customers"("id");--> statement-breakpoint
UPDATE "truck_requests" tr SET "customer_id" = ps."customer_id"
  FROM "project_sites" ps WHERE ps."id" = tr."project_site_id" AND tr."customer_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_requests_customer_id_idx" ON "truck_requests" ("customer_id");--> statement-breakpoint
-- What goes on the truck ("1x CAT 320 excavator, ~22 t"), read by both sides.
ALTER TABLE "truck_requests" ADD COLUMN "load_description" text;--> statement-breakpoint
ALTER TABLE "truck_requests" ADD CONSTRAINT "truck_requests_load_description_len"
  CHECK ("load_description" IS NULL OR char_length("load_description") BETWEEN 1 AND 300);--> statement-breakpoint
-- The agreed price the customer last accepted. Checkout needs it to equal
-- agreed_price_php, so every staff price change is re-approved. Requests
-- already agreed under the old cap rule count as accepted when within it.
ALTER TABLE "truck_requests" ADD COLUMN "accepted_price_php" numeric(14, 2);--> statement-breakpoint
UPDATE "truck_requests" SET "accepted_price_php" = "agreed_price_php"
  WHERE "agreed_price_php" IS NOT NULL AND "cap_php" IS NOT NULL AND "agreed_price_php" <= "cap_php";--> statement-breakpoint

-- 2. The tenant's Facebook Messenger link, offered beside the in-app chat.
-- It lands in an href: https on a Messenger or Facebook host, nothing else.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "messenger_url" text;--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_messenger_url_https";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_messenger_url_https"
  CHECK ("messenger_url" IS NULL OR "messenger_url" ~ '^https://(m\.me|(www\.)?messenger\.com|([a-z0-9-]+\.)*facebook\.com)/');--> statement-breakpoint

-- 3. Branding write, 14 arguments (0060's 13 plus messenger_url). The
-- 13-argument overload stays for the API revision still rolling out.
CREATE OR REPLACE FUNCTION tenants_update_branding(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_primary_color text,
  p_header_color text,
  p_font text,
  p_tagline text,
  p_about text,
  p_phone text,
  p_contact_email text,
  p_address text,
  p_city text,
  p_province text,
  p_facebook_url text,
  p_messenger_url text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tenants SET
    primary_color = p_primary_color, header_color = p_header_color, font = p_font,
    tagline = p_tagline, about = p_about, phone = p_phone, contact_email = p_contact_email,
    address = p_address, city = p_city, province = p_province, facebook_url = p_facebook_url,
    messenger_url = p_messenger_url
  WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
  VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_branding', p_tenant_id, NULL);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_update_branding(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_update_branding(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text) TO app_authenticated;--> statement-breakpoint

-- 4. Public branding adds the Messenger link. The TIN is NOT public: it is
-- read only by signed-in users of the tenant (tenants_get_tin, step 6) for
-- the printed documents' letterhead.
DROP FUNCTION IF EXISTS catalog_get_tenant(text);--> statement-breakpoint
CREATE FUNCTION catalog_get_tenant(p_slug text)
RETURNS TABLE (
  name text, logo_key text, hero_key text, icon_key text, primary_color text, header_color text,
  font text, tagline text, about text, phone text, contact_email text, address text, city text,
  province text, facebook_url text, messenger_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.logo_key, t.hero_key, t.icon_key, t.primary_color, t.header_color,
    t.font, t.tagline, t.about, t.phone, t.contact_email, t.address, t.city,
    t.province, t.facebook_url, t.messenger_url
  FROM tenants t WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_tenant(text) TO app_authenticated;--> statement-breakpoint

DROP FUNCTION IF EXISTS tenants_get_branding(uuid);--> statement-breakpoint
CREATE FUNCTION tenants_get_branding(p_tenant_id uuid)
RETURNS TABLE (
  legal_name text, slug text, logo_key text, hero_key text, icon_key text, primary_color text,
  header_color text, font text, tagline text, about text, phone text, contact_email text,
  address text, city text, province text, facebook_url text, messenger_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.slug, t.logo_key, t.hero_key, t.icon_key, t.primary_color,
    t.header_color, t.font, t.tagline, t.about, t.phone, t.contact_email,
    t.address, t.city, t.province, t.facebook_url, t.messenger_url
  FROM tenants t WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_branding(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_branding(uuid) TO app_authenticated;;--> statement-breakpoint

-- 6. The rental company's TIN (its approved application's) for printed
-- invoices and statements. The API passes the verified JWT's tenant only.
CREATE FUNCTION tenants_get_tin(p_tenant_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.tin FROM tenant_applications a
  WHERE a.tenant_id = p_tenant_id AND a.status = 'approved'
  ORDER BY a.reviewed_at DESC NULLS LAST LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_tin(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_tin(uuid) TO app_authenticated;
