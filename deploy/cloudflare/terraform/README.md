# Terraform: Tunnel + DNS + Access

This Terraform config provisions:

- A Cloudflare Tunnel (`cloudflare_tunnel` + `cloudflare_tunnel_config`)
- DNS `CNAME` for `apktool.thewilners.com` to the tunnel
- Cloudflare Access application + policy restricting to `allowed_emails`

## Usage

```bash
cd /home/jonathan/src/apktool/deploy/cloudflare/terraform

export CLOUDFLARE_API_TOKEN=...

nix shell nixpkgs#terraform -c terraform init
nix shell nixpkgs#terraform -c terraform apply
```

Create `terraform.tfvars`:

```hcl
account_id     = "..."
zone_id        = "..."
allowed_emails = ["you@example.com"]
```

After apply:

```bash
nix shell nixpkgs#terraform -c terraform output -raw tunnel_token
```

Then on the origin host:

```bash
cloudflared tunnel --no-autoupdate run --token "$(nix shell nixpkgs#terraform -c terraform output -raw tunnel_token)"
```
