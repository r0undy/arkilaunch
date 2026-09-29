# Non-secret config only; secrets come via TF_VAR_* in CI.

location           = "southeastasia"
web_origin         = "https://arkilaunch.app" # placeholder: arkilaunch.app serves dev; prod needs its own host
supabase_url       = "https://<prod-project-ref>.supabase.co" # fill in against the actual prod Supabase project

# Pilot posture: feature flags stay off until each module is explicitly turned on.
enable_ocr_pipeline  = false
enable_ocr_kyc       = false
enable_weather_poll  = false
enable_diesel_scrape = true
enable_payments      = false
