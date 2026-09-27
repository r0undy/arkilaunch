-- Hand-authored, expand-only (CR: cr-arkilaunch-tenant-brand-kit.md).
-- Four more storefront branding fields beside 0051's: a header color for the
-- tenant's top bar, a square icon (favicon / app-bar mark), a Facebook page
-- and a font choice. Same write path as 0051: narrow SECURITY DEFINER
-- functions, audited; app_authenticated gets no new grant on `tenants`.
--
-- Expand-only because deploy.yml migrates before `terraform apply` rolls the
-- API: the old revision keeps calling the 10-argument
-- tenants_update_branding, so that overload stays (drop it in a later
-- contract step) and the new fields get a 13-argument one. The two read
-- functions change return type, so they are dropped and recreated in this
-- transaction; the old revision reads their columns by name.

-- 1. Columns. All nullable, so no backfill; NULL keeps today's look.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS header_color text,
  ADD COLUMN IF NOT EXISTS icon_key text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS font text;--> statement-breakpoint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_header_color_hex;--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_header_color_hex
  CHECK (header_color IS NULL OR header_color ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
-- It lands in an href on a public page: https on a Facebook host, nothing else.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_facebook_url_https;--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_facebook_url_https
  CHECK (facebook_url IS NULL OR facebook_url ~ '^https://([a-z0-9-]+\.)*(facebook|fb)\.com/');--> statement-breakpoint
-- NULL is the design-system default (IBM Plex).
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_font_known;--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_font_known
  CHECK (font IS NULL OR font IN ('inter'));--> statement-breakpoint

-- 2. Branding write, 13 arguments. Same caller contract as 0051's: the API
-- passes the JWT's tenant (owner/admin) or a platform admin's chosen company;
-- never the platform tenant, never legal_name/slug/status.
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
  p_facebook_url text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tenants SET
    primary_color = p_primary_color, header_color = p_header_color, font = p_font,
    tagline = p_tagline, about = p_about, phone = p_phone, contact_email = p_contact_email,
    address = p_address, city = p_city, province = p_province, facebook_url = p_facebook_url
  WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
  VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_branding', p_tenant_id, NULL);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_update_branding(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_update_branding(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) TO app_authenticated;--> statement-breakpoint

-- 3. Image keys: 'icon' joins 'logo' and 'hero'. Same signature as 0051.
CREATE OR REPLACE FUNCTION tenants_set_branding_image(
  p_tenant_id uuid, p_actor_user_id uuid, p_kind text, p_key text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_kind = 'logo' THEN
    UPDATE tenants SET logo_key = p_key WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  ELSIF p_kind = 'hero' THEN
    UPDATE tenants SET hero_key = p_key WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  ELSIF p_kind = 'icon' THEN
    UPDATE tenants SET icon_key = p_key WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
  VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_branding', p_tenant_id, p_kind);
END;
$$;--> statement-breakpoint

-- 4. Public storefront branding, now with the four new fields.
DROP FUNCTION IF EXISTS catalog_get_tenant(text);--> statement-breakpoint
CREATE FUNCTION catalog_get_tenant(p_slug text)
RETURNS TABLE (
  name text, logo_key text, hero_key text, icon_key text, primary_color text, header_color text,
  font text, tagline text, about text, phone text, contact_email text, address text, city text,
  province text, facebook_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.logo_key, t.hero_key, t.icon_key, t.primary_color, t.header_color,
    t.font, t.tagline, t.about, t.phone, t.contact_email, t.address, t.city,
    t.province, t.facebook_url
  FROM tenants t WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_tenant(text) TO app_authenticated;--> statement-breakpoint

-- 5. The branding form's current values, same caller contract as step 2.
DROP FUNCTION IF EXISTS tenants_get_branding(uuid);--> statement-breakpoint
CREATE FUNCTION tenants_get_branding(p_tenant_id uuid)
RETURNS TABLE (
  legal_name text, slug text, logo_key text, hero_key text, icon_key text, primary_color text,
  header_color text, font text, tagline text, about text, phone text, contact_email text,
  address text, city text, province text, facebook_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.slug, t.logo_key, t.hero_key, t.icon_key, t.primary_color,
    t.header_color, t.font, t.tagline, t.about, t.phone, t.contact_email,
    t.address, t.city, t.province, t.facebook_url
  FROM tenants t WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_branding(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_branding(uuid) TO app_authenticated;
