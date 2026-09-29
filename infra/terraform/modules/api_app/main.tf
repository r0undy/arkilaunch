# UserAssigned, not SystemAssigned: AcrPull must propagate before the app exists or ACA
# provisioning times out with zero revisions. Callers must depends_on the identity module.
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
