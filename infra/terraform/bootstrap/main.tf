# One-time remote-state bootstrap, applied by hand with LOCAL state (it can't use
# the backend it creates). Never run by CI.

terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

variable "subscription_id" {
  type        = string
  description = "Azure subscription id to bootstrap state storage into."
}

variable "github_subject_prefix" {
  type        = string
  description = <<-EOT
    The prefix GitHub puts in the OIDC token's subject claim, without the
    trailing ":environment:<env>". Read it from GitHub rather than composing
    it by hand, because the format is not a given:

      gh api repos/<owner>/<repo>/actions/oidc/customization/sub \
        --jq .sub_claim_prefix

    With immutable subjects enabled (the default for new repositories) this
    is "repo:<owner>@<owner-id>/<repo>@<repo-id>", not "repo:<owner>/<repo>".
    Guessing the readable form produces a credential that never matches, and
    AADSTS700213 is the only symptom.
  EOT

  validation {
    condition     = can(regex("^repo:[^:]+$", var.github_subject_prefix))
    error_message = "github_subject_prefix must start with \"repo:\" and carry no further colon, e.g. repo:owner@1234/name@5678."
  }
}

variable "location" {
  type        = string
  default     = "southeastasia"
  description = "Southeast Asia (Singapore) region, per the PH data-residency intent in docs/clr-arkilaunch.md gap E1. Azure DI model/region availability confirmed (docs/cr-arkilaunch-azure-di-provisioning.md); RA 10173 cross-border transfer basis (AIA-R7) remains open."
}

resource "azurerm_resource_group" "state" {
  name     = "rg-arkilaunch-tfstate"
  location = var.location
}

# GRS: state must survive a single-region outage.
resource "azurerm_storage_account" "state" {
  name                     = "starkilaunchtfstate"
  resource_group_name      = azurerm_resource_group.state.name
  location                 = azurerm_resource_group.state.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true # protects against a bad apply corrupting state history
  }
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

output "storage_account_name" {
  value = azurerm_storage_account.state.name
}

output "container_name" {
  value = azurerm_storage_container.tfstate.name
}

output "resource_group_name" {
  value = azurerm_resource_group.state.name
}

# --- GitHub Actions deploy identity (OIDC, no long-lived secret) ---
# Managed identity, not an app registration: this tenant won't let us own app registrations.

resource "azurerm_resource_group" "identity" {
  name     = "rg-arkilaunch-identity"
  location = var.location
}

resource "azurerm_user_assigned_identity" "github_deploy" {
  name                = "id-arkilaunch-github-deploy"
  resource_group_name = azurerm_resource_group.identity.name
  location            = azurerm_resource_group.identity.location
}

# Subscription scope: apply creates and destroys whole resource groups.
resource "azurerm_role_assignment" "github_deploy" {
  scope                = "/subscriptions/${var.subscription_id}"
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# `terraform init` lists state blobs (data plane), which Contributor can't; scoped to the state account only.
resource "azurerm_role_assignment" "github_deploy_state" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# `environment:` subject form, since deploy.yml jobs declare `environment:`; a mismatch fails as AADSTS700213.
resource "azurerm_federated_identity_credential" "github_env" {
  for_each = toset(["dev", "prod"])

  name                      = "arkilaunch-github-${each.key}"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "${var.github_subject_prefix}:environment:${each.key}"
}

# GitHub environment variables, not secrets: neither value is sensitive.
output "github_deploy_client_id" {
  value       = azurerm_user_assigned_identity.github_deploy.client_id
  description = "Set as the AZURE_CLIENT_ID environment variable in GitHub."
}

output "github_deploy_tenant_id" {
  value       = azurerm_user_assigned_identity.github_deploy.tenant_id
  description = "Set as the AZURE_TENANT_ID environment variable in GitHub."
}
