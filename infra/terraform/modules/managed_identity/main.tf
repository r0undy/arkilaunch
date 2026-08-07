# A pre-created User Assigned Identity for ACR pull, shared by the API app
# and every cron job in one environment. Exists to break a real chicken-and-egg
# discovered running this for the first time: a SystemAssigned identity is
# only created alongside its Container App/Job, so the AcrPull role
# assignment can only be granted AFTER that workload already exists and is
# already trying to pull its image -- and Azure's own revision-provisioning
# timeout can expire (observed: "Operation expired", provisioningState=Failed,
# zero revisions ever created) before the AAD role-assignment propagates,
# with no automatic retry once ACA gives up. A UserAssigned identity has no
# such ordering constraint: it (and its role assignment) can be fully
# provisioned, with time to propagate, before any workload ever references it.
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

# AAD role-assignment propagation lag is exactly what caused the failure
# this module fixes -- give it real time to land before anything tries to
# use the identity to pull an image.
resource "time_sleep" "acr_role_propagation" {
  depends_on      = [azurerm_role_assignment.acr_pull]
  create_duration = "60s"
}
