-- Hand-authored, additive (CR: tenant-self-serve-branding). Registration
-- auto-approves (email activation is the gate), tenants carry editable
-- public branding, and the platform host lists active tenants.
-- `tenants` is global with the tenant_self policy (0016) and 0007 revoked
-- column UPDATE for everything but legal_name, so every write below is a
-- narrow SECURITY DEFINER function; app_authenticated gets no new grant.

-- 1. Branding columns. All nullable, so no backfill.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS logo_key text,
  ADD COLUMN IF NOT EXISTS hero_key text,
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS about text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text;--> statement-breakpoint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_primary_color_hex;--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_primary_color_hex
  CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$');--> statement-breakpoint

-- 2. Registration auto-approves. Same body as 0009 except: the application
-- is written 'approved', and the duplicate guard now looks for any
-- not-yet-activated tenant owned by that email (an auto-approved tenant is
-- no longer 'pending', so the old check would let one email mint tenants
-- without limit).
CREATE OR REPLACE FUNCTION tenants_register(
  p_legal_name text,
  p_slug text,
  p_owner_email text,
  p_placeholder_password_hash text,
  p_company_name text,
  p_business_address text,
  p_sec_number text,
  p_tin text,
  p_contact_first_name text,
  p_contact_last_name text,
  p_contact_mobile text,
  p_contact_job_title text
)
RETURNS TABLE (tenant_id uuid, owner_user_id uuid, application_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_owner_role_id uuid;
  v_owner_user_id uuid;
  v_application_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE t.status = 'onboarding' AND u.status = 'invited' AND lower(u.email) = lower(p_owner_email)
  ) THEN
    RAISE EXCEPTION 'duplicate_pending_application' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_owner_role_id FROM roles WHERE name = 'owner';
  IF v_owner_role_id IS NULL THEN
    RAISE EXCEPTION 'owner_role_not_seeded';
  END IF;

  INSERT INTO tenants (legal_name, slug, status, kyc_state, address)
  VALUES (p_legal_name, p_slug, 'onboarding', 'unverified', p_business_address)
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (tenant_id, role_id, email, password_hash, status)
  VALUES (v_tenant_id, v_owner_role_id, lower(p_owner_email), p_placeholder_password_hash, 'invited')
  RETURNING id INTO v_owner_user_id;

  INSERT INTO tenant_applications (
    tenant_id, company_name, business_address, sec_number, tin,
    contact_first_name, contact_last_name, contact_mobile, contact_job_title, status, reviewed_at
  )
  VALUES (
    v_tenant_id, p_company_name, p_business_address, p_sec_number, p_tin,
    p_contact_first_name, p_contact_last_name, p_contact_mobile, p_contact_job_title, 'approved', now()
  )
  RETURNING id INTO v_application_id;

  RETURN QUERY SELECT v_tenant_id, v_owner_user_id, v_application_id;
END;
$$;--> statement-breakpoint

-- 3. Owner activation takes an auto-approved tenant live. Called by
-- POST /auth/activate right after the invited owner sets a password (the
-- signed activation token is the proof of email ownership). A no-op for a
-- staff invite (tenant already active) and for a legacy 'pending'
-- application, which still needs /tenants/:id/approve.
CREATE OR REPLACE FUNCTION tenants_activate_onboarding(p_tenant_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE tenants t SET status = 'active'
  WHERE t.id = p_tenant_id AND t.status = 'onboarding'
    AND EXISTS (
      SELECT 1 FROM tenant_applications ta
      WHERE ta.tenant_id = t.id AND ta.status = 'approved'
    );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_activate_onboarding(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_activate_onboarding(uuid) TO app_authenticated;--> statement-breakpoint

-- 4. Public storefront branding. Return type changes, so drop and recreate.
DROP FUNCTION IF EXISTS catalog_get_tenant(text);--> statement-breakpoint
CREATE FUNCTION catalog_get_tenant(p_slug text)
RETURNS TABLE (
  name text, logo_key text, hero_key text, primary_color text, tagline text,
  about text, phone text, contact_email text, address text, city text, province text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.logo_key, t.hero_key, t.primary_color, t.tagline,
    t.about, t.phone, t.contact_email, t.address, t.city, t.province
  FROM tenants t WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_tenant(text) TO app_authenticated;--> statement-breakpoint

-- 5. Platform directory. Active rental companies only: never the platform
-- tenant or the test fixtures. Public columns only. Filters are optional
-- (NULL = no filter); the caller pages with LIMIT/OFFSET.
CREATE OR REPLACE FUNCTION catalog_list_tenants(p_q text, p_category text, p_province text)
RETURNS TABLE (
  slug text, name text, logo_key text, tagline text, city text, province text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.slug, t.legal_name, t.logo_key, t.tagline, t.city, t.province
  FROM tenants t
  WHERE t.status = 'active'
    AND t.slug NOT IN ('arkilaunch-platform', 'test-tenant-a', 'test-tenant-b')
    AND (p_q IS NULL OR t.legal_name ILIKE '%' || p_q || '%')
    AND (p_province IS NULL OR t.province ILIKE p_province)
    AND (p_category IS NULL OR EXISTS (
      SELECT 1 FROM equipment e
      JOIN equipment_types et ON et.id = e.equipment_type_id
      WHERE e.tenant_id = t.id AND e.retired_at IS NULL AND et.name = p_category
    ))
  ORDER BY t.legal_name;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_list_tenants(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_tenants(text, text, text) TO app_authenticated;--> statement-breakpoint

-- 6. Branding write. The API passes the tenant from the verified JWT
-- (owner/admin, tenant:manage) or a platform admin's chosen company
-- (tenant:approve); this function never lets the platform tenant be
-- branded and never touches legal_name, slug or status. Every column is
-- replaced as given (the API sends the full form). Logo/hero keys are
-- written separately by tenants_set_branding_image().
CREATE OR REPLACE FUNCTION tenants_update_branding(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_primary_color text,
  p_tagline text,
  p_about text,
  p_phone text,
  p_contact_email text,
  p_address text,
  p_city text,
  p_province text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tenants SET
    primary_color = p_primary_color, tagline = p_tagline, about = p_about,
    phone = p_phone, contact_email = p_contact_email, address = p_address,
    city = p_city, province = p_province
  WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
  VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_branding', p_tenant_id, NULL);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_update_branding(uuid, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_update_branding(uuid, uuid, text, text, text, text, text, text, text, text) TO app_authenticated;--> statement-breakpoint

-- Logo / hero image key. p_kind is 'logo' or 'hero'; NULL key removes it.
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
REVOKE ALL ON FUNCTION tenants_set_branding_image(uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_set_branding_image(uuid, uuid, text, text) TO app_authenticated;
--> statement-breakpoint

-- The branding form's current values. Same caller contract as
-- tenants_update_branding: the API passes the JWT's tenant (owner/admin)
-- or a platform admin's chosen company.
CREATE OR REPLACE FUNCTION tenants_get_branding(p_tenant_id uuid)
RETURNS TABLE (
  legal_name text, slug text, logo_key text, hero_key text, primary_color text, tagline text,
  about text, phone text, contact_email text, address text, city text, province text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.slug, t.logo_key, t.hero_key, t.primary_color, t.tagline,
    t.about, t.phone, t.contact_email, t.address, t.city, t.province
  FROM tenants t WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_branding(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_branding(uuid) TO app_authenticated;
