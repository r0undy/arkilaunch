output "id" {
  value = azurerm_user_assigned_identity.acr_pull.id
}

output "principal_id" {
  value = azurerm_user_assigned_identity.acr_pull.principal_id
}

# Depend on this output (not just the module) wherever the identity is USED
# to pull an image, so Terraform's graph forces the 60s propagation wait to
# complete first -- see time_sleep.acr_role_propagation above.
output "ready" {
  value = time_sleep.acr_role_propagation.id
}
