variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "container_app_environment_id" {
  type = string
}

variable "registry_login_server" {
  type = string
}

variable "identity_id" {
  type        = string
  description = "Resource ID of the shared UserAssigned identity (modules/managed_identity) used both for the Container App's own identity and to authenticate the ACR pull. Callers must also set depends_on = [module.<that identity module>] on this module block, so its AcrPull role assignment has time to propagate before this resource is created."
}

variable "image_name" {
  type    = string
  default = "arkilaunch-backend"
}

variable "image_tag" {
  type        = string
  description = "Set per deploy by CI (git SHA) -- see .github/workflows/deploy.yml."
}

variable "container_port" {
  type    = number
  default = 3000 # matches API_PORT default in .env.example
}

variable "min_replicas" {
  type    = number
  default = 1
}

variable "max_replicas" {
  type    = number
  default = 3
}

variable "cpu" {
  type    = number
  default = 0.5
}

variable "memory" {
  type    = string
  default = "1Gi"
}

variable "env_vars" {
  type        = map(string)
  default     = {}
  description = "Plain (non-secret) env vars, e.g. NODE_ENV, feature flags, ANCHOR_TENANT_SLUG."
}

variable "secrets" {
  type        = map(string)
  default     = {}
  sensitive   = true
  description = "Container App secret store: name -> value. Referenced by secret_env_vars, keyed by the same name."
}

variable "secret_env_vars" {
  type        = map(string)
  default     = {}
  description = "Env var name -> secret name (from var.secrets) it reads from, e.g. { DATABASE_URL_POOLED = \"database-url-pooled\" }."
}

variable "tags" {
  type    = map(string)
  default = {}
}
