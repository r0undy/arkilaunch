# Non-secret config only. Secrets are supplied via TF_VAR_* in CI (see
# .github/workflows/deploy.yml and infra/terraform/bootstrap/README.md).

location           = "southeastasia"
web_origin         = "https://arkilaunch.app" # placeholder -- replace with the real production domain
anchor_tenant_slug = "almara"
supabase_url       = "https://<prod-project-ref>.supabase.co" # fill in against the actual prod Supabase project

# Pilot posture (docs/ops-arkilaunch.md §0): one production tenant, feature
# flags stay off until each module is explicitly turned on.
enable_ocr_pipeline  = false
enable_ocr_kyc       = false
enable_quote_engine  = false
enable_diesel_scrape = false
enable_payments      = false
