# Non-secret config only. Secrets are supplied via TF_VAR_* in CI (see
# .github/workflows/deploy.yml and infra/terraform/bootstrap/README.md).

location           = "southeastasia"
web_origin         = "https://arkilaunch-dev.vercel.app"
anchor_tenant_slug = "almara"
supabase_url       = "https://ydalnvzyeseycdakofgp.supabase.co" # derived from the project ref in the local .env's DATABASE_URL_POOLED

enable_ocr_pipeline  = false
enable_ocr_kyc       = false
enable_quote_engine  = false
enable_diesel_scrape = false
enable_payments      = false
