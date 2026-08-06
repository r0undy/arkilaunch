output "fqdn" {
  value = azurerm_container_app.this.latest_revision_fqdn
}

output "id" {
  value = azurerm_container_app.this.id
}
