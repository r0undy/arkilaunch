variable "name" {
  type        = string
  description = "Globally unique registry name (alphanumeric, no hyphens)."
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "sku" {
  type    = string
  default = "Basic"
}

variable "tags" {
  type    = map(string)
  default = {}
}
