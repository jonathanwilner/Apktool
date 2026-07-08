# Cloudflare Deployment (Access + Tunnel)

This app cannot run on Cloudflare Workers (it needs `apktool` + `apksigner` + Java), so the Cloudflare setup here uses:

- **Cloudflare Tunnel** to expose the local origin safely (no inbound ports)
- **Cloudflare Access** to require authentication for `apktool.thewilners.com`

## 1) Prereqs

- Domain `thewilners.com` is on Cloudflare DNS
- You have Cloudflare Zero Trust enabled for your account
- You have a host to run the origin (this repo) and `cloudflared` (NixOS box, VPS, or always-on workstation)

## 2) Terraform: create Tunnel + DNS + Access

```bash
cd /home/jonathan/src/apktool/deploy/cloudflare/terraform

# Set a token with permissions for DNS + Tunnel + Access (Zero Trust)
export CLOUDFLARE_API_TOKEN=...   # recommended

nix shell nixpkgs#terraform -c terraform init
nix shell nixpkgs#terraform -c terraform apply
```

You will need to provide:

- `account_id`
- `zone_id` for `thewilners.com`
- `allowed_emails` (who can access the app)

After apply, Terraform will output a `tunnel_token` and the `hostname`.

## 3) Run the origin + tunnel on your host

### Start the origin (apktool-web)

```bash
cd /home/jonathan/src/apktool

# The Access header check is optional but recommended in production.
REQUIRE_CF_ACCESS=1 \
ALLOWED_EMAILS="you@example.com,other@example.com" \
nix run .#web
```

### Start cloudflared using the token output by Terraform

```bash
cloudflared tunnel --no-autoupdate run --token '<TUNNEL_TOKEN_FROM_TERRAFORM>'
```

Now `https://apktool.thewilners.com` should prompt with Cloudflare Access and then proxy to your origin.
