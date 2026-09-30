output "id" {
  value = azurerm_user_assigned_identity.acr_pull.id
}

output "principal_id" {
  value = azurerm_user_assigned_identity.acr_pull.principal_id
}

# Depend on this output where the identity pulls, so the propagation wait completes first.
output "ready" {
  value = time_sleep.acr_role_propagation.id
}
