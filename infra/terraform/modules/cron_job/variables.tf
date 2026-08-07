variable "name" {
  type        = string
  description = "ACA Job resource name, e.g. arkilaunch-weather-poll."
}

variable "entrypoint" {
  type        = string
  description = "jobs/src/<entrypoint>.ts -- compiled to jobs/dist/<entrypoint>.js, e.g. \"weather-poll\"."
}

variable "cron_expression" {
  type        = string
  description = "Standard 5-field cron. Only weather-poll's cadence (every 30 min) is stated in ops-arkilaunch.md (SLO-8); the other three jobs' defaults are this module caller's best inference, not a settled spec -- confirm with product/ops before relying on them."
}

variable "resource_group_name" {
  type = string
}

variable "location" {
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
  description = "Resource ID of the shared UserAssigned identity (modules/managed_identity). Callers must also set depends_on = [module.<that identity module>] on this module block."
}

variable "image_name" {
  type    = string
  default = "arkilaunch-backend"
}

variable "image_tag" {
  type = string
}

variable "timeout_seconds" {
  type    = number
  default = 600
}

variable "retry_limit" {
  type    = number
  default = 1
}

variable "cpu" {
  type    = number
  default = 0.25
}

variable "memory" {
  type    = string
  default = "0.5Gi"
}

variable "env_vars" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  type      = map(string)
  default   = {}
  sensitive = true
}

variable "secret_env_vars" {
  type    = map(string)
  default = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
