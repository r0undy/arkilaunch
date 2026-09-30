-- Tenant sign-in image: a photo beside the sign-in / sign-up forms.
-- Display image only, same trust level as hero_key. Nullable, no backfill.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS login_key text;--> statement-breakpoint

-- 'login' joins 'logo', 'hero' and 'icon'. Same signature as 0060, grants kept.
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
  ELSIF p_kind = 'login' THEN
    UPDATE tenants SET login_key = p_key WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
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

DROP FUNCTION IF EXISTS catalog_get_tenant(text);--> statement-breakpoint
CREATE FUNCTION catalog_get_tenant(p_slug text)
RETURNS TABLE (
  name text, logo_key text, hero_key text, icon_key text, login_key text, primary_color text, header_color text,
  font text, tagline text, about text, phone text, contact_email text, address text, city text,
  province text, facebook_url text, messenger_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.logo_key, t.hero_key, t.icon_key, t.login_key, t.primary_color, t.header_color,
    t.font, t.tagline, t.about, t.phone, t.contact_email, t.address, t.city,
    t.province, t.facebook_url, t.messenger_url
  FROM tenants t WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_tenant(text) TO app_authenticated;--> statement-breakpoint

DROP FUNCTION IF EXISTS tenants_get_branding(uuid);--> statement-breakpoint
CREATE FUNCTION tenants_get_branding(p_tenant_id uuid)
RETURNS TABLE (
  legal_name text, slug text, logo_key text, hero_key text, icon_key text, login_key text, primary_color text,
  header_color text, font text, tagline text, about text, phone text, contact_email text,
  address text, city text, province text, facebook_url text, messenger_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.slug, t.logo_key, t.hero_key, t.icon_key, t.login_key, t.primary_color,
    t.header_color, t.font, t.tagline, t.about, t.phone, t.contact_email,
    t.address, t.city, t.province, t.facebook_url, t.messenger_url
  FROM tenants t WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_branding(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_branding(uuid) TO app_authenticated;
