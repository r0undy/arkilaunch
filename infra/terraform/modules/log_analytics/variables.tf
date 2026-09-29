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
  default = 90
}

variable "app_insights_retention_in_days" {
  type    = number
  default = 30
}

variable "app_insights_daily_cap_gb" {
  type    = number
  default = 1 # cost backstop
}

variable "tags" {
  type    = map(string)
  default = {}
}
