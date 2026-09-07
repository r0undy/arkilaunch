# Azure AI Document Intelligence (ARM kind "FormRecognizer" -- unchanged by
# the product rename). This is extraction only: it never decides, activates
# a tenant, or moves money (RFC-2 §5, AGENTS.md golden path). Provisioning
# this resource re-arms AIA-R7 (cross-border PH data residency) as a launch
# blocker -- see docs/cr-arkilaunch-azure-di-provisioning.md. Both
# ENABLE_OCR_PIPELINE and ENABLE_OCR_KYC stay false in every environment
# until counsel clears CLR gap E1.
#
# custom_subdomain_name is required for API-key auth against the
# documentintelligence/* routes and for custom model training later; it must
# be globally unique, so it reuses the resource name.
resource "azurerm_cognitive_account" "this" {
  name                  = var.name
  kind                  = "FormRecognizer"
  sku_name              = var.sku_name
  location              = var.location
  resource_group_name   = var.resource_group_name
  custom_subdomain_name = var.name
  tags                  = var.tags
}
