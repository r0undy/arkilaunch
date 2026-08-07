# The persistent apps/api Container App. Secrets/env vars are passed as
# generic maps (not one variable per .env.example key) so this module never
# needs editing when the app's own env contract changes -- the caller
# (environments/{dev,prod}/main.tf) is the single place that lists what's
# actually wired in, sourced from docs/runbook-local-dev.md / .env.example.
#
# Pulls via a pre-created UserAssigned identity (modules/managed_identity),
# not SystemAssigned -- a SystemAssigned identity only exists once this
# resource is created, so its AcrPull role assignment can only be granted
# afterward, and Azure's own revision-provisioning timeout can expire while
# waiting for that just-granted role to propagate through AAD (observed in
# practice: "Operation expired", provisioningState=Failed, zero revisions,
# no automatic retry). The caller MUST set depends_on = [module.<identity
# module>] on this module block so the identity's role assignment (and its
# 60s propagation wait, modules/managed_identity's time_sleep) is fully
# settled before this resource is created.
resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server   = var.registry_login_server
    identity = var.identity_id
  }

  dynamic "secret" {
    for_each = var.secrets
    content {
      name  = secret.key
      value = secret.value
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.container_port
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name    = var.name
      image   = "${var.registry_login_server}/${var.image_name}:${var.image_tag}"
      cpu     = var.cpu
      memory  = var.memory
      command = ["node", "apps/api/dist/main.js"]

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      liveness_probe {
        transport = "HTTP"
        path      = "/health"
        port      = var.container_port
      }

      readiness_probe {
        transport = "HTTP"
        path      = "/health"
        port      = var.container_port
      }
    }
  }
}
