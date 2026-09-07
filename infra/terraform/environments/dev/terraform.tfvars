# Non-secret config only. Secrets are supplied via TF_VAR_* in CI (see
# .github/workflows/deploy.yml and infra/terraform/bootstrap/README.md).

location           = "southeastasia"
web_origin         = "https://arkilaunch-dev.vercel.app"
anchor_tenant_slug = "almara"
supabase_url       = "https://ydalnvzyeseycdakofgp.supabase.co" # derived from the project ref in the local .env's DATABASE_URL_POOLED

enable_ocr_pipeline  = false
enable_ocr_kyc       = false
# On in dev only (docs/cr-arkilaunch-open-meteo-free-tier.md): the free
# tier is keyless, so there is no credential-provisioning step left to gate
# on the way the OCR flags above are. Prod's terraform.tfvars keeps this
# false -- an operator flips it deliberately after checking active-site
# count against the free tier's ~200-site ceiling (WEATHER_POLL_MAX_SITES).
enable_weather_poll  = true
enable_diesel_scrape = false
enable_payments      = false
