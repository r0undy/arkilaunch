# Non-secret config (defaults live in terraform.tfvars, committed).

variable "location" {
  type    = string
  default = "southeastasia" # PH data-residency intent, docs/clr-arkilaunch.md gap E1. Azure DI model/region availability confirmed (docs/cr-arkilaunch-azure-di-provisioning.md); the RA 10173 cross-border transfer basis (AIA-R7) is the remaining open item, not region availability.
}

variable "image_tag" {
  type        = string
  description = "Set per deploy: TF_VAR_image_tag=$GITHUB_SHA in CI (see .github/workflows/deploy.yml)."
}

variable "web_origin" {
  type        = string
  description = "CORS origin for the prod frontend (production Vercel domain)."
}

variable "anchor_tenant_slug" {
  type = string
}

variable "supabase_url" {
  type = string
}

variable "supabase_storage_bucket_edtr" {
  type    = string
  default = "edtr-documents"
}

variable "supabase_storage_bucket_kyc" {
  type    = string
  default = "kyc-documents"
}

variable "enable_ocr_pipeline" {
  type    = bool
  default = false
}

variable "enable_ocr_kyc" {
  type    = bool
  default = false
}

variable "enable_weather_poll" {
  type    = bool
  default = false
}

variable "enable_diesel_scrape" {
  type    = bool
  default = false
}

variable "enable_payments" {
  type    = bool
  default = false
}

variable "jwt_access_token_ttl" {
  type    = string
  default = "600" # seconds; see apps/api/src/auth/auth.service.ts's JWT_ACCESS_TOKEN_TTL read
}

# Cron cadences: only weather-poll's is stated in ops-arkilaunch.md (SLO-8,
# every 30 min). The other three are this plan's inferred defaults, not a
# settled spec -- confirm with product/ops before relying on them.
variable "weather_poll_cron" {
  type    = string
  default = "*/30 * * * *"
}

variable "edtr_ocr_worker_cron" {
  type    = string
  default = "*/5 * * * *"
}

variable "diesel_cron" {
  type    = string
  default = "0 6 * * *"
}

variable "maintenance_notify_cron" {
  type    = string
  default = "0 7 * * *"
}

# --- Secrets: sourced from GitHub encrypted secrets via TF_VAR_* in CI,
# never committed to terraform.tfvars. ---

variable "database_url_direct" {
  type      = string
  sensitive = true
}

variable "database_url_pooled" {
  type      = string
  sensitive = true
}

variable "app_authenticated_password" {
  type      = string
  sensitive = true
}

variable "supabase_service_role_key" {
  type      = string
  sensitive = true
}

variable "jwt_private_key" {
  type      = string
  sensitive = true
}

variable "jwt_public_key" {
  type      = string
  sensitive = true
}

variable "paymongo_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "paymongo_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "paymongo_success_url" {
  type    = string
  default = ""
}

variable "paymongo_cancel_url" {
  type    = string
  default = ""
}

variable "open_meteo_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
