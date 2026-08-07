# One registry per environment (no shared blast radius between dev/prod --
# see the plan's environment-isolation rationale).
resource "azurerm_container_registry" "this" {
  name                = var.name # must be globally unique, alphanumeric only
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku
  admin_enabled       = false # CI authenticates via OIDC + AcrPush role, not the admin user/password
  tags                = var.tags
}
