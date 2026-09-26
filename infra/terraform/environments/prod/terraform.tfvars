# Non-secret config only. Secrets are supplied via TF_VAR_* in CI (see
# .github/workflows/deploy.yml and infra/terraform/bootstrap/README.md).

location           = "southeastasia"
web_origin         = "https://arkilaunch.app" # placeholder -- arkilaunch.app currently serves dev (docs/cr-arkilaunch-cloudflare-frontend.md); prod needs its own host decision before it is provisioned
supabase_url       = "https://<prod-project-ref>.supabase.co" # fill in against the actual prod Supabase project

# Pilot posture (docs/ops-arkilaunch.md §0): one production tenant, feature
# flags stay off until each module is explicitly turned on.
enable_ocr_pipeline  = false
enable_ocr_kyc       = false
enable_weather_poll  = false
enable_diesel_scrape = true
enable_payments      = false
