-- Hand-authored supplemental migration. Additive, non-destructive; safe to
-- re-run (CREATE OR REPLACE). Same @Public, anchor-tenant-only, SECURITY
-- DEFINER rationale as catalog_list_equipment (migration 0010) -- there is
-- no tenant GUC for an unauthenticated storefront visitor, so this is the
-- same narrow, read-only, single-purpose exception (RFC-1 / AGENTS.md
-- "Never" a client-supplied tenant_id), not a service_role grant on the
-- request path. Only returns rows when the tenant is 'active'.
CREATE OR REPLACE FUNCTION catalog_list_testimonials(p_slug text)
RETURNS TABLE (
  id uuid, quote text, author_name text, author_title text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.id, tm.quote, tm.author_name, tm.author_title
  FROM testimonials tm
  JOIN tenants t ON t.id = tm.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active';
$$;
REVOKE ALL ON FUNCTION catalog_list_testimonials(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_list_testimonials(text) TO app_authenticated;
