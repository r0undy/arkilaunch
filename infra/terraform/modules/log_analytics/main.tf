resource "azurerm_log_analytics_workspace" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days
  tags                = var.tags
}

resource "azurerm_application_insights" "this" {
  name                = "${var.name}-appi"
  resource_group_name = var.resource_group_name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "Node.JS"
  retention_in_days   = var.app_insights_retention_in_days
  # Cost backstop for a runaway (e.g. re-enabled console log capture double-billing every line).
  daily_data_cap_in_gb                 = var.app_insights_daily_cap_gb
  daily_data_cap_notifications_enabled = true
  tags                                 = var.tags
}
