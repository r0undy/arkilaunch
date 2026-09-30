# parallelism=1 + replica_completion_count=1 is the overlap guard: no concurrent runs.
# UserAssigned identity for the same reason as api_app; callers must depends_on it.
resource "azurerm_container_app_job" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = var.container_app_environment_id
  replica_timeout_in_seconds   = var.timeout_seconds
  replica_retry_limit          = var.retry_limit
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

  schedule_trigger_config {
    cron_expression          = var.cron_expression
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name    = var.name
      image   = "${var.registry_login_server}/${var.image_name}:${var.image_tag}"
      cpu     = var.cpu
      memory  = var.memory
      command = ["node", "jobs/dist/${var.entrypoint}.js"]

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
    }
  }
}
