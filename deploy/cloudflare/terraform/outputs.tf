output "hostname" {
  value = var.hostname
}

output "tunnel_id" {
  value = cloudflare_tunnel.apktool.id
}

output "tunnel_token" {
  value       = cloudflare_tunnel.apktool.tunnel_token
  description = "Use with: cloudflared tunnel run --token <tunnel_token>"
  sensitive   = true
}
