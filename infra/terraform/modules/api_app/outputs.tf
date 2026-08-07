output "fqdn" {
  # App-stable ingress FQDN, not `latest_revision_fqdn` -- that one changes on
  # every deploy and can never be a stable VITE_API_BASE_URL for the frontend.
  value = azurerm_container_app.this.ingress[0].fqdn
}

output "id" {
  value = azurerm_container_app.this.id
}
