-- The DOE scrape cron writes this table too, and it runs on the same
-- pooled app_authenticated client as every request path (client.ts) --
-- not as service_role, which is what RFC-3 §2's "writes come from the
-- service_role cron" reads like and what migration 0005's comment
-- assumed. Revoking INSERT without this would have silently broken the
-- daily diesel refresh, leaving every quote pricing off a frozen
-- last-known reading.
--
-- A separate function rather than a `source` parameter on the one above:
-- each entry point hard-codes its own source, so a hand-typed price can
-- never be recorded as a scrape, and a scrape can never be recorded as
-- manual.
CREATE OR REPLACE FUNCTION diesel_record_scrape_reading(
  p_region text,
  p_price_php numeric,
  p_observed_date date,
  p_source_url text
) RETURNS diesel_price_readings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row diesel_price_readings;
BEGIN
  INSERT INTO diesel_price_readings (region, price_php, observed_date, source, source_url)
  VALUES (p_region, p_price_php, p_observed_date, 'doe_scrape', p_source_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION diesel_record_scrape_reading(text, numeric, date, text) TO app_authenticated;
