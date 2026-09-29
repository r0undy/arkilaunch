# Extraction only: never decides, activates a tenant, or moves money (RFC-2 §5).
# custom_subdomain_name is required for API-key auth and must be globally unique.
resource "azurerm_cognitive_account" "this" {
  name                  = var.name
  kind                  = "FormRecognizer"
  sku_name              = var.sku_name
  location              = var.location
  resource_group_name   = var.resource_group_name
  custom_subdomain_name = var.name
  tags                  = var.tags
}
