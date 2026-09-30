# Pre-created so AcrPull propagates before any workload pulls; SystemAssigned timed out ACA provisioning.
resource "azurerm_user_assigned_identity" "acr_pull" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.registry_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.acr_pull.principal_id
}

# Wait out AAD role-assignment propagation before any pull.
resource "time_sleep" "acr_role_propagation" {
  depends_on      = [azurerm_role_assignment.acr_pull]
  create_duration = "60s"
}
