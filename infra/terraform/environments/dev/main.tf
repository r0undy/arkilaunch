terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.11"
    }
  }

  # storage_account_name comes from bootstrap via `terraform init -backend-config`.
  backend "azurerm" {
    resource_group_name = "rg-arkilaunch-tfstate"
    container_name      = "tfstate"
    key                 = "dev.tfstate"
    use_azuread_auth    = true
  }
}

provider "azurerm" {
  features {}
}

locals {
  env  = "dev"
  name = "arkilaunch-${local.env}"
  tags = { environment = local.env, project = "arkilaunch" }

  # Azure rejects empty secret values, so unset vendor keys are filtered out, not wired blank.
  all_secrets = {
    database-url-direct           = var.database_url_direct
    database-url-pooled           = var.database_url_pooled
    app-authenticated-password    = var.app_authenticated_password
    supabase-service-role-key     = var.supabase_service_role_key
    jwt-private-key               = var.jwt_private_key
    jwt-public-key                = var.jwt_public_key
    azure-di-endpoint             = module.document_intelligence.endpoint
    azure-di-key                  = module.document_intelligence.primary_access_key
    paymongo-secret-key           = var.paymongo_secret_key
    paymongo-webhook-secret       = var.paymongo_webhook_secret
    ors-api-key                   = var.ors_api_key
    turnstile-secret-key          = var.turnstile_secret_key
    vapid-private-key             = var.vapid_private_key
    appinsights-connection-string = module.log_analytics.app_insights_connection_string
  }
  secrets = { for k, v in local.all_secrets : k => v if v != "" }

  all_secret_env_vars = {
    DATABASE_URL_DIRECT                   = "database-url-direct"
    DATABASE_URL_POOLED                   = "database-url-pooled"
    APP_AUTHENTICATED_PASSWORD            = "app-authenticated-password"
    SUPABASE_SERVICE_ROLE_KEY             = "supabase-service-role-key"
    JWT_PRIVATE_KEY                       = "jwt-private-key"
    JWT_PUBLIC_KEY                        = "jwt-public-key"
    AZURE_DI_ENDPOINT                     = "azure-di-endpoint"
    AZURE_DI_KEY                          = "azure-di-key"
    PAYMONGO_SECRET_KEY                   = "paymongo-secret-key"
    PAYMONGO_WEBHOOK_SECRET               = "paymongo-webhook-secret"
    ORS_API_KEY                           = "ors-api-key"
    TURNSTILE_SECRET_KEY                  = "turnstile-secret-key"
    VAPID_PRIVATE_KEY                     = "vapid-private-key"
    APPLICATIONINSIGHTS_CONNECTION_STRING = "appinsights-connection-string"
  }
  secret_env_vars = { for k, v in local.all_secret_env_vars : k => v if contains(keys(local.secrets), v) }

  common_env_vars = {
    NODE_ENV                     = local.env == "prod" ? "production" : "development"
    API_PORT                     = "3000"
    WEB_ORIGIN                   = var.web_origin
    PLATFORM_DOMAIN              = var.platform_domain
    SUPABASE_URL                 = var.supabase_url
    SUPABASE_STORAGE_BUCKET_EDTR = var.supabase_storage_bucket_edtr
    SUPABASE_STORAGE_BUCKET_KYC  = var.supabase_storage_bucket_kyc
    JWT_ACCESS_TOKEN_TTL         = var.jwt_access_token_ttl
    ENABLE_OCR_PIPELINE          = tostring(var.enable_ocr_pipeline)
    ENABLE_OCR_KYC               = tostring(var.enable_ocr_kyc)
    ENABLE_WEATHER_POLL          = tostring(var.enable_weather_poll)
    WEATHER_POLL_MAX_SITES       = tostring(var.weather_poll_max_sites)
    VAPID_PUBLIC_KEY             = var.vapid_public_key
    VAPID_SUBJECT                = var.vapid_subject
    ENABLE_DIESEL_SCRAPE         = tostring(var.enable_diesel_scrape)
    ENABLE_PAYMENTS              = tostring(var.enable_payments)
    TURNSTILE_ENABLED            = tostring(var.enable_turnstile)
    # F0 analyzes only 2 pages; the adapter hard-fails rather than truncate.
    AZURE_DI_MAX_PAGES = "2"
  }
}

module "resource_group" {
  source   = "../../modules/resource_group"
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

module "container_registry" {
  source              = "../../modules/container_registry"
  name                = "acrarkilaunch${local.env}" # alphanumeric only, globally unique
  resource_group_name = module.resource_group.name
  location            = var.location
  tags                = local.tags
}

module "log_analytics" {
  source              = "../../modules/log_analytics"
  name                = "law-${local.name}"
  resource_group_name = module.resource_group.name
  location            = var.location
  tags                = local.tags
}

module "document_intelligence" {
  source              = "../../modules/document_intelligence"
  name                = "di-${local.name}"
  resource_group_name = module.resource_group.name
  location            = var.location
  sku_name            = "F0" # dev: smoke-test tier only, never a real multi-page document
  tags                = local.tags
}

module "container_apps_environment" {
  source                     = "../../modules/container_apps_environment"
  name                       = "cae-${local.name}"
  resource_group_name        = module.resource_group.name
  location                   = var.location
  log_analytics_workspace_id = module.log_analytics.workspace_id
  tags                       = local.tags
}

# Shared ACR-pull identity for the API app and all jobs.
module "acr_identity" {
  source              = "../../modules/managed_identity"
  name                = "id-${local.name}-acrpull"
  resource_group_name = module.resource_group.name
  location            = var.location
  registry_id         = module.container_registry.id
  tags                = local.tags
}

module "api_app" {
  source                       = "../../modules/api_app"
  name                         = "ca-${local.name}-api"
  resource_group_name          = module.resource_group.name
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  min_replicas                 = 1
  max_replicas                 = 2
  cpu                          = 0.5
  memory                       = "1Gi"
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

module "weather_poll_job" {
  source                       = "../../modules/cron_job"
  name                         = "${local.name}-weather-poll"
  entrypoint                   = "weather-poll"
  cron_expression              = var.weather_poll_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

module "weather_briefing_job" {
  source                       = "../../modules/cron_job"
  name                         = "${local.name}-weather-briefing"
  entrypoint                   = "weather-briefing"
  cron_expression              = var.weather_briefing_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

module "edtr_ocr_worker_job" {
  source                       = "../../modules/cron_job"
  name                         = "${local.name}-edtr-ocr-worker"
  entrypoint                   = "edtr-ocr-worker"
  cron_expression              = var.edtr_ocr_worker_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

module "diesel_job" {
  source                       = "../../modules/cron_job"
  name                         = "${local.name}-diesel"
  entrypoint                   = "diesel"
  cron_expression              = var.diesel_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

module "maintenance_notify_job" {
  source = "../../modules/cron_job"
  # ACA job names cap at 32 chars, hence "pm-notify".
  name                         = "${local.name}-pm-notify"
  entrypoint                   = "maintenance-notify"
  cron_expression              = var.maintenance_notify_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

module "hold_expiry_job" {
  source                       = "../../modules/cron_job"
  name                         = "${local.name}-hold-expiry"
  entrypoint                   = "hold-expiry"
  cron_expression              = var.hold_expiry_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}

output "api_fqdn" {
  value = module.api_app.fqdn
}

output "azure_di_endpoint" {
  value = module.document_intelligence.endpoint
}

output "registry_login_server" {
  value = module.container_registry.login_server
}

module "weekly_billing_job" {
  source                       = "../../modules/cron_job"
  name                         = "${local.name}-weekly-billing"
  entrypoint                   = "weekly-billing"
  cron_expression              = var.weekly_billing_cron
  resource_group_name          = module.resource_group.name
  location                     = var.location
  container_app_environment_id = module.container_apps_environment.id
  registry_login_server        = module.container_registry.login_server
  identity_id                  = module.acr_identity.id
  image_tag                    = var.image_tag
  env_vars                     = local.common_env_vars
  secrets                      = local.secrets
  secret_env_vars              = local.secret_env_vars
  tags                         = local.tags
  depends_on                   = [module.acr_identity]
}
