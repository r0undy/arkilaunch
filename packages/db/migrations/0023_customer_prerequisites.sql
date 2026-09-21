ALTER TABLE "customers" ADD COLUMN "tin" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "project_sites" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_sites_customer_id_idx" ON "project_sites" USING btree ("customer_id");--> statement-breakpoint
-- Hand-authored: customer self-signup (customer prerequisites CR). Same
-- shape as tenants_register (0009): an unauthenticated caller has no tenant
-- context, so a narrow SECURITY DEFINER function does the one insert. The
-- tenant slug comes from the API's ANCHOR_TENANT_SLUG env, never the
-- client. Email is rejected if it exists in ANY tenant, because login
-- resolves a user by email alone.
CREATE OR REPLACE FUNCTION customer_register(p_tenant_slug text, p_email text, p_password_hash text)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_role_id uuid;
  v_user_id uuid;
BEGIN
  SELECT t.id INTO v_tenant_id FROM tenants t WHERE t.slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'storefront_tenant_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(p_email)) THEN
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
REVOKE ALL ON FUNCTION customer_register(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customer_register(text, text, text) TO app_authenticated;
