# Non-secret config only. Secrets are supplied via TF_VAR_* in CI (see
# .github/workflows/deploy.yml and infra/terraform/bootstrap/README.md).

location           = "southeastasia"
# The CORS allowlist for the API. Must be the deployment's real origin and must
# match exactly -- main.ts passes it straight to enableCors({ origin }), which
# compares strings, so no trailing slash. arkilaunch-dev.vercel.app was aspirational:
# that domain was never created, so every browser login was blocked by CORS and
# surfaced in the UI as "incorrect email or password".
web_origin         = "https://arkilaunch-web-24lk.vercel.app"
anchor_tenant_slug = "almara"
supabase_url       = "https://ydalnvzyeseycdakofgp.supabase.co" # derived from the project ref in the local .env's DATABASE_URL_POOLED

# On in dev at the operator's explicit direction
# (docs/cr-arkilaunch-edtr-real-form.md §7) so the EDTR layout-table path can
# be exercised. AIA-R7 stays Open (escalated) and CLR gap E1 is NOT cleared:
# only machine-generated sheets with invented values have been sent. A filled
# Almara sheet carries an operator name and signature, which are personal data
# under RA 10173, and sending one is a separate decision. prod stays false.
enable_ocr_pipeline  = true
enable_ocr_kyc       = false
# On in dev only (docs/cr-arkilaunch-open-meteo-free-tier.md): the free
# tier is keyless, so there is no credential-provisioning step left to gate
# on the way the OCR flags above are. Prod's terraform.tfvars keeps this
# false -- an operator flips it deliberately after checking active-site
# count against the free tier's ~200-site ceiling (WEATHER_POLL_MAX_SITES).
enable_weather_poll  = true
enable_diesel_scrape = true
enable_payments      = false
