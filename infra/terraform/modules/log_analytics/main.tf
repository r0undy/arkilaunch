# ops-arkilaunch.md: "Metrics | Azure Monitor metrics for API + ACA Jobs...";
# "Traces | OpenTelemetry from NestJS to Azure Monitor (Application
# Insights)". Retention defaults match ops-arkilaunch.md's stated windows
# (metrics 90 days, traces 14-30 days) rounded to the nearest LA-supported tier.
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
  # Cost backstop, not a steady-state control -- this only fires on a
  # runaway (an error loop, or a future change re-enabling console/winston
  # log capture, which would double-bill every log line the ACA environment
  # already ships to this same workspace).
  daily_data_cap_in_gb                 = var.app_insights_daily_cap_gb
  daily_data_cap_notifications_enabled = true
  tags                                 = var.tags
}
