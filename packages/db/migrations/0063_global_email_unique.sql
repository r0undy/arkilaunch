-- Hand-authored (CR: cr-arkilaunch-global-email-unique.md). One login per
-- email across the whole platform. users_tenant_email_uq only stopped a
-- repeat inside one tenant; customer_register's cross-tenant check lived
-- in code (two concurrent signups both passed it), tenants_register only
-- refused a not-yet-activated owner, and Gmail's dot and +tag aliases all
-- read as different addresses. The unique index below is the rule; the
-- function checks only answer 'email_taken' early (a concurrent signup
-- that slips past them loses on the index, which tenant-register.ts maps
-- to the same answer).

-- 1. The comparison key: trimmed, lowercased, and for Gmail the dots and
-- +tag dropped from the local part (Gmail delivers all of them to one box).
CREATE OR REPLACE FUNCTION email_key(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN split_part(e, '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(e, '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE e
  END
  FROM (SELECT lower(btrim(p_email)) AS e) s
$$;--> statement-breakpoint

-- 2. Refuse to build the index over existing duplicates rather than
-- rewrite anyone's login. To clear a dev database, list them with
--   SELECT email_key(email), array_agg(email || ' / ' || tenant_id)
--   FROM users GROUP BY 1 HAVING count(*) > 1;
-- and delete (or re-address) the throwaway account by hand.
DO $$
DECLARE
  v_dupes text;
BEGIN
  SELECT string_agg(k, ', ') INTO v_dupes
  FROM (SELECT email_key(email) AS k FROM users GROUP BY 1 HAVING count(*) > 1) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'users share an email across accounts, resolve before 0063: %', v_dupes;
  END IF;
END;
$$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key_uq ON users (email_key(email));--> statement-breakpoint

-- 3. customer_register (0048): the existing-account check compares keys.
-- Otherwise unchanged.
CREATE OR REPLACE FUNCTION customer_register(p_tenant_slug text, p_email text, p_password_hash text)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_role_id uuid;
  v_user_id uuid;
BEGIN
  SELECT t.id INTO v_tenant_id FROM tenants t WHERE t.slug = p_tenant_slug AND t.status = 'active';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'storefront_tenant_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE email_key(u.email) = email_key(p_email)) THEN
    RAISE EXCEPTION 'email_taken' USING ERRCODE = '23505';
  END IF;
  SELECT r.id INTO v_role_id FROM roles r WHERE r.name = 'customer';
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'customer_role_not_seeded';
  END IF;

  INSERT INTO users (tenant_id, role_id, email, password_hash, status)
  VALUES (v_tenant_id, v_role_id, lower(p_email), p_password_hash, 'active')
  RETURNING id INTO v_user_id;

  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$;--> statement-breakpoint

-- 4. tenants_register (0051): after the pending-application guard (kept
-- first so its message is unchanged), any existing account on the email
-- is refused. Otherwise unchanged.
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
    WHERE t.status = 'onboarding' AND u.status = 'invited' AND email_key(u.email) = email_key(p_owner_email)
  ) THEN
    RAISE EXCEPTION 'duplicate_pending_application' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE email_key(u.email) = email_key(p_owner_email)) THEN
    RAISE EXCEPTION 'email_taken' USING ERRCODE = '23505';
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
$$;
