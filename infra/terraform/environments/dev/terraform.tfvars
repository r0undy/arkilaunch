# Non-secret config only; secrets come via TF_VAR_* in CI.

location           = "southeastasia"
# Exact origin, no trailing slash: enableCors compares strings; a mismatch shows as "incorrect email or password".
web_origin         = "https://arkilaunch.app"
supabase_url       = "https://ydalnvzyeseycdakofgp.supabase.co"

# Dev only, synthetic sheets: a real filled sheet carries personal data (RA 10173). prod stays false.
enable_ocr_pipeline  = true
enable_ocr_kyc       = false
# Dev only; prod flips it after checking active sites against the ~200-site free-tier ceiling.
enable_weather_poll  = true
enable_diesel_scrape = true
enable_payments      = true
enable_turnstile     = true
