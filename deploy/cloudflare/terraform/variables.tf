variable "account_id" {
  type        = string
  description = "Cloudflare account id (Zero Trust account)."
}

variable "zone_id" {
  type        = string
  description = "Zone id for thewilners.com."
}

variable "zone_name" {
  type        = string
  description = "Zone name (e.g. thewilners.com)."
  default     = "thewilners.com"
}

variable "hostname" {
  type        = string
  description = "Full hostname to expose (e.g. apktool.thewilners.com)."
  default     = "apktool.thewilners.com"
}

variable "tunnel_name" {
  type        = string
  description = "Cloudflare tunnel name."
  default     = "apktool"
}

variable "origin_url" {
  type        = string
  description = "Origin URL cloudflared should connect to on the host."
  default     = "http://127.0.0.1:8787"
}

variable "allowed_emails" {
  type        = list(string)
  description = "Email addresses allowed by Cloudflare Access."
}

variable "session_duration" {
  type        = string
  description = "Cloudflare Access session duration."
  default     = "24h"
}
