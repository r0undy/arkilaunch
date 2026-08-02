-- Hand-authored supplemental migration (cr-arkilaunch-f2-f8-bookings-payments.md).
-- Additive, non-destructive; safe to re-run (CREATE OR REPLACE).

-- The PayMongo webhook (POST /api/v1/webhooks/paymongo) arrives with no
-- JWT and therefore no tenant context -- exactly the situation
-- auth_find_user_by_email/auth_find_refresh_token already solve for
-- login/refresh (0002_force_rls_and_grants.sql). Same pattern here: RLS is
-- forced and fail-closed, so app_authenticated cannot see ANY row without
-- a tenant GUC set first, but the webhook must resolve which tenant an
-- event belongs to BEFORE it can open a withTenantTx. This narrow,
-- read-only, single-purpose SECURITY DEFINER function is that one
-- exception -- not a service_role grant on the request path, and not a
-- client-supplied tenant_id (RFC-1 / AGENTS.md "Never").
--
-- Keyed on invoice_id (carried in the PayMongo checkout session's
-- `metadata.invoice_id`, set at checkout-session-creation time in
-- apps/api/src/ports/payments.port.ts), not on provider_ref: the exact
-- payment-object-to-checkout-session field name PayMongo uses was not
-- independently confirmed against live docs this pass (see the CR), so
-- resolving via the invoice_id WE set as metadata is the more defensible
-- design -- it depends only on the confirmed, documented `metadata` field
-- on checkout session creation, not on an unverified propagation detail.
CREATE OR REPLACE FUNCTION payments_find_tenant_by_invoice(p_invoice_id uuid)
RETURNS TABLE (
  tenant_id uuid, invoice_id uuid, rental_id uuid, invoice_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.tenant_id, i.id, i.rental_id, i.status
  FROM invoices i
  WHERE i.id = p_invoice_id;
$$;
REVOKE ALL ON FUNCTION payments_find_tenant_by_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments_find_tenant_by_invoice(uuid) TO app_authenticated;
