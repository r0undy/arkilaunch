output "fqdn" {
  # Stable ingress FQDN; latest_revision_fqdn changes every deploy.
  value = azurerm_container_app.this.ingress[0].fqdn
}

output "id" {
  value = azurerm_container_app.this.id
}
