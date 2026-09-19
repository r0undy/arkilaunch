-- audit-db-tenant-isolation.md #7: app_authenticated held INSERT on
-- diesel_price_readings, a GLOBAL table with no RLS. It was granted in
-- 0005 so the platform-admin manual-entry route could work on the normal
-- request path, gated only by an app-layer diesel:manage check. Migrations
-- 0007 and 0016 took the opposite decision for every other global
-- reference table -- revoke to SELECT -- precisely because one missing
-- permission check on any route reaching such a table is enough. Here the
-- blast radius is every tenant's quote formula, which freezes the diesel
-- price it reads.
--
-- The route keeps working, through the same SECURITY DEFINER shape the
-- tenant-registration path already uses: the privilege lives in one
-- auditable function rather than in a standing table grant.

CREATE OR REPLACE FUNCTION diesel_record_manual_reading(
  p_region text,
  p_price_php numeric,
  p_observed_date date,
  p_source_url text,
  p_captured_by uuid
) RETURNS diesel_price_readings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row diesel_price_readings;
BEGIN
  -- source is fixed here, not taken from the caller: this function exists
  -- only for the manual-entry path, and letting a caller pass
  -- 'doe_scrape' would let a hand-typed price masquerade as the scrape.
  INSERT INTO diesel_price_readings (region, price_php, observed_date, source, source_url, captured_by)
  VALUES (p_region, p_price_php, p_observed_date, 'platform_manual', p_source_url, p_captured_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE INSERT ON diesel_price_readings FROM app_authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION diesel_record_manual_reading(text, numeric, date, text, uuid) TO app_authenticated;
