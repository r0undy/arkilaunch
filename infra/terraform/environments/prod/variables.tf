variable "location" {
  type    = string
  default = "southeastasia" # PH data residency; RA 10173 cross-border basis still open
}

variable "image_tag" {
  type        = string
  description = "Set per deploy: TF_VAR_image_tag=$GITHUB_SHA in CI (see .github/workflows/deploy.yml)."
}

variable "web_origin" {
  type        = string
  description = "CORS origin for the prod frontend (its Cloudflare host)."
}

variable "platform_domain" {
  type        = string
  description = "Root domain; tenant storefronts at https://{slug}.<domain> are allowed by the API's CORS."
  default     = "arkilaunch.app"
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

# Turnstile CR: on, the API refuses to boot without turnstile_secret_key.
variable "enable_turnstile" {
  type    = bool
  default = false
}

variable "jwt_access_token_ttl" {
  type    = string
  default = "600" # seconds
}

variable "weather_poll_cron" {
  type    = string
  default = "*/30 * * * *"
}

# Open-Meteo free tier: 10k calls/day, ~200 sites at 30-min cadence; over the ceiling truncates loudly.
variable "weather_poll_max_sites" {
  type    = number
  default = 200
}

# 05:30 Asia/Manila = 21:30 UTC the day before.
variable "weather_briefing_cron" {
  type    = string
  default = "30 21 * * *"
}

# Generate once with `npx web-push generate-vapid-keys`; empty skips push.
variable "vapid_public_key" {
  type    = string
  default = ""
}

variable "vapid_private_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "vapid_subject" {
  type    = string
  default = "mailto:support@arkilaunch.app"
}

variable "edtr_ocr_worker_cron" {
  type    = string
  default = "*/5 * * * *"
}

variable "diesel_cron" {
  type    = string
  default = "0 22 * * 0" # weekly, Monday 06:00 PHT (UTC cron)
}

variable "maintenance_notify_cron" {
  type    = string
  default = "0 7 * * *"
}

variable "hold_expiry_cron" {
  type    = string
  default = "5 * * * *"
}

# --- Secrets: TF_VAR_* from GitHub encrypted secrets, never committed. ---

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

variable "ors_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "turnstile_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}


variable "weekly_billing_cron" {
  type    = string
  default = "0 23 * * 0" # weekly, Monday 07:00 PHT (UTC cron), after the diesel run
}
