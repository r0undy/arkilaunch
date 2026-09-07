variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "retention_in_days" {
  type    = number
  default = 90 # ops-arkilaunch.md: metrics retained 90 days
}

variable "app_insights_retention_in_days" {
  type    = number
  default = 30 # ops-arkilaunch.md: traces 14-30 days, 100% sampled on error
}

variable "app_insights_daily_cap_gb" {
  type    = number
  default = 1 # cost backstop, not a steady-state control -- expected steady state is well under this
}

variable "tags" {
  type    = map(string)
  default = {}
}
