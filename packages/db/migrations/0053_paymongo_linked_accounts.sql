-- Hand-authored, additive (CR: cr-arkilaunch-paymongo-linked-accounts.md).
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS).

-- 1. The tenant's PayMongo child account (Platforms / Linked Accounts).
-- ArkiLaunch's own PayMongo account is the parent; a checkout routes its
-- net amount to this org with split_payment.transfer_to. NULL = not linked
-- yet, and that tenant takes cash only. Read by the tenant's own requests
-- through the existing tenant_self policy; written only below.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paymongo_account_id text;--> statement-breakpoint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_paymongo_account_id_chk;--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_paymongo_account_id_chk
  CHECK (paymongo_account_id IS NULL OR paymongo_account_id ~ '^org_[A-Za-z0-9]+$');--> statement-breakpoint

-- 2. Platform admin links (or unlinks, NULL) a company's PayMongo account
-- from /admin/companies. Same contract as tenants_update_branding (0051):
-- the API decides the tenant, the platform tenant is refused, every write
-- is audited.
CREATE OR REPLACE FUNCTION tenants_set_paymongo_account(
  p_tenant_id uuid, p_actor_user_id uuid, p_account_id text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tenants SET paymongo_account_id = p_account_id
  WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
  VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_paymongo_account', p_tenant_id, p_account_id);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_set_paymongo_account(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_set_paymongo_account(uuid, uuid, text) TO app_authenticated;--> statement-breakpoint

-- The admin form's current value (platform admin reads another company's
-- row, which tenant_self hides). The tenant's own checkout reads its row
-- directly under RLS instead.
CREATE OR REPLACE FUNCTION tenants_get_paymongo_account(p_tenant_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.paymongo_account_id FROM tenants t WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_paymongo_account(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_paymongo_account(uuid) TO app_authenticated;--> statement-breakpoint

-- 3. PayMongo's own payment id (pay_...), stamped when a checkout settles.
-- provider_ref keeps the checkout session id (cs_...), or the refund id
-- (ref_...) on a refunded row. Refunds are issued against this id and the
-- refund webhook carries it back.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_id_key ON payments (provider_payment_id);--> statement-breakpoint

-- 4. The refund webhook (payment.refund.updated) carries a refund, not our
-- metadata, so it resolves its tenant from the paid payment it refunds.
-- Same narrow pre-tenant lookup as payments_find_tenant_by_invoice (0006).
CREATE OR REPLACE FUNCTION payments_find_tenant_by_provider_payment(p_provider_payment_id text)
RETURNS TABLE (tenant_id uuid, invoice_id uuid, rental_id uuid, invoice_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.tenant_id, i.id, i.rental_id, i.status
  FROM payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE p.provider_payment_id = p_provider_payment_id;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION payments_find_tenant_by_provider_payment(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION payments_find_tenant_by_provider_payment(text) TO app_authenticated;
