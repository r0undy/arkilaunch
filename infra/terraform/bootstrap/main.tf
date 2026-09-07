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
