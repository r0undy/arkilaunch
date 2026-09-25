-- Hand-authored, additive (customer feedback 3: GasWatch diesel price).
--
-- GasWatch PH (gaswatchph.com/api/prices) becomes the diesel source: the
-- weekly job and the admin "Fetch now" button record the national average
-- of its per-station diesel prices. Its own function hard-codes
-- source='gaswatch', same reasoning as 0021: no entry point can record a
-- price under another source's name.
ALTER TABLE "diesel_price_readings" DROP CONSTRAINT IF EXISTS "source_valid";--> statement-breakpoint
ALTER TABLE "diesel_price_readings" ADD CONSTRAINT "source_valid" CHECK ("source" IN ('doe_scrape','platform_manual','admin_override','gaswatch'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION diesel_record_gaswatch_reading(
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
  VALUES (p_region, p_price_php, p_observed_date, 'gaswatch', p_source_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION diesel_record_gaswatch_reading(text, numeric, date, text) TO app_authenticated;
