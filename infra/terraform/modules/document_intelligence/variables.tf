variable "name" {
  type        = string
  description = "Globally unique resource + custom-subdomain name."
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "sku_name" {
  type        = string
  default     = "F0"
  description = "F0 (free) analyzes only the first 2 pages per document and caps files at 4MB -- fine for dev smoke tests, wrong for any real multi-page EDTR/KYC document. Use S0 wherever real documents will be sent. Azure allows at most one F0 Cognitive Services account per subscription per region."
}

variable "tags" {
  type    = map(string)
  default = {}
}
