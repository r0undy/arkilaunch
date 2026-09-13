# One-time bootstrap: creates the storage account + container that later
# holds Terraform's remote state for environments/{dev,prod}. Applied
# manually, ONCE per Azure subscription, with LOCAL state (chicken-and-egg --
# this can't itself use the remote backend it's creating). Never run by CI.
#
# Usage:
#   cd infra/terraform/bootstrap
#   terraform init
#   terraform apply -var subscription_id=<sub-id>
#
# After apply, note the storage_account_name output and put it in
# environments/{dev,prod}/main.tf's backend "azurerm" block.

terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
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

variable "github_repository" {
  type        = string
  description = "GitHub repository the deploy workflow runs from, as \"owner/name\". Used to scope the OIDC federated credential subjects."

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository must be in \"owner/name\" form, e.g. r0undy/arkilaunch."
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

# GRS: state must survive a single-region outage independent of the
# environments it describes.
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

# --- GitHub Actions deploy identity -------------------------------------
#
# `.github/workflows/deploy.yml` authenticates with OIDC federation, so there
# is no long-lived Service Principal secret to rotate or leak. Declared here
# rather than left as README prose because every Deploy run since 2026-08-06
# failed at `azure/login`: the app registration this describes had never been
# created (docs/cr-arkilaunch-azure-di-provisioning.md section 6).

resource "azuread_application" "github_deploy" {
  display_name = "arkilaunch-github-deploy"
}

resource "azuread_service_principal" "github_deploy" {
  client_id = azuread_application.github_deploy.client_id
}

# Contributor at subscription scope: the workflow runs `terraform apply` for
# whole environments, so it creates and destroys resource groups.
resource "azurerm_role_assignment" "github_deploy" {
  scope                = "/subscriptions/${var.subscription_id}"
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_deploy.object_id
}

# Subject must be the `environment:` form, not `ref:refs/heads/`. Both jobs in
# deploy.yml declare `environment:`, and GitHub then issues the token with
# subject `repo:<owner>/<name>:environment:<env>` -- a credential registered
# against the branch-ref form can never match and login fails closed.
resource "azuread_application_federated_identity_credential" "github_env" {
  for_each = toset(["dev", "prod"])

  application_id = azuread_application.github_deploy.id
  display_name   = "arkilaunch-github-${each.key}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_repository}:environment:${each.key}"
}

# Paste these into the GitHub `dev` and `prod` environments as variables, not
# secrets: OIDC needs no client secret and neither value is sensitive.
output "github_deploy_client_id" {
  value       = azuread_application.github_deploy.client_id
  description = "Set as the AZURE_CLIENT_ID environment variable in GitHub."
}

output "github_deploy_tenant_id" {
  value       = data.azuread_client_config.current.tenant_id
  description = "Set as the AZURE_TENANT_ID environment variable in GitHub."
}

data "azuread_client_config" "current" {}
