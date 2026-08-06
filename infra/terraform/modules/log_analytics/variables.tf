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

variable "tags" {
  type    = map(string)
  default = {}
}
