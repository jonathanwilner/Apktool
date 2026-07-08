locals {
  hostname = var.hostname
}

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_tunnel" "apktool" {
  account_id = var.account_id
  name       = var.tunnel_name

  # The provider expects a base64-encoded secret.
  secret = random_id.tunnel_secret.b64_std
}

resource "cloudflare_tunnel_config" "apktool" {
  account_id = var.account_id
  tunnel_id  = cloudflare_tunnel.apktool.id

  config {
    ingress_rule {
      hostname = local.hostname
      service  = var.origin_url
    }

    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_dns_record" "apktool" {
  zone_id = var.zone_id

  # For a zone "thewilners.com", name "apktool" => apktool.thewilners.com
  name    = replace(local.hostname, ".${var.zone_name}", "")
  type    = "CNAME"
  content = "${cloudflare_tunnel.apktool.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

resource "cloudflare_access_application" "apktool" {
  account_id = var.account_id
  name       = "apktool"
  domain     = local.hostname
  type       = "self_hosted"

  session_duration = var.session_duration
}

resource "cloudflare_access_policy" "allow_emails" {
  account_id     = var.account_id
  application_id = cloudflare_access_application.apktool.id

  name       = "Allow specific emails"
  decision   = "allow"
  precedence = 1

  include {
    email = var.allowed_emails
  }
}
