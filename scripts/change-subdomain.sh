#!/bin/bash
# SayGG Gateway — change or set the subdomain
# - Updates Nginx vhost
# - (Re)issues Let's Encrypt SSL
# - Restarts services
#
# Usage:
#   sudo ./scripts/change-subdomain.sh                    # interactive
#   sudo ./scripts/change-subdomain.sh gateway.saygg.shop you@example.com
#
# Cloudflare users: BEFORE running, set the subdomain DNS record to "DNS only"
# (grey cloud) so Let's Encrypt can verify. Re-enable proxy after success.

set -uo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/SayGG-Gateway}"
NGINX_AVAIL="/etc/nginx/sites-available/saygg-gateway"
NGINX_ENABL="/etc/nginx/sites-enabled/saygg-gateway"
APP_PORT="${APP_PORT:-5000}"

c_reset='\033[0m'; c_red='\033[1;31m'; c_grn='\033[1;32m'
c_ylw='\033[1;33m'; c_blu='\033[1;34m'

say()  { printf "${c_blu}» %s${c_reset}\n" "$*"; }
ok()   { printf "${c_grn}✓ %s${c_reset}\n" "$*"; }
warn() { printf "${c_ylw}! %s${c_reset}\n" "$*"; }
err()  { printf "${c_red}✗ %s${c_reset}\n" "$*" >&2; }

if [[ "$EUID" -ne 0 ]]; then
  err "Please run as root (use sudo)."
  exit 1
fi

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  CURRENT="(none)"
  if [[ -f "$NGINX_AVAIL" ]]; then
    CURRENT="$(grep -E '^\s*server_name' "$NGINX_AVAIL" | head -n1 | awk '{print $2}' | tr -d ';')"
  fi
  echo "Current subdomain: $CURRENT"
  read -r -p "Enter the NEW subdomain (e.g. gateway.saygg.shop): " DOMAIN
fi
if [[ -z "$DOMAIN" ]]; then err "Subdomain is required."; exit 1; fi

if [[ -z "$EMAIL" ]]; then
  read -r -p "Enter contact email for SSL renewal: " EMAIL
fi
if [[ -z "$EMAIL" ]]; then err "Email is required."; exit 1; fi

# 1) Make sure Nginx is installed
if ! command -v nginx >/dev/null 2>&1; then
  say "Installing Nginx…"
  apt update -y && apt install -y nginx
fi

# 2) Make sure certbot is installed
if ! command -v certbot >/dev/null 2>&1; then
  say "Installing certbot…"
  apt install -y certbot python3-certbot-nginx
fi

# 3) Write the Nginx vhost
say "Writing Nginx config for $DOMAIN…"
cat > "$NGINX_AVAIL" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_AVAIL" "$NGINX_ENABL"

if ! nginx -t; then
  err "Nginx config test failed. Aborting."
  exit 1
fi
systemctl reload nginx
ok "Nginx config applied"

# 4) DNS sanity check
say "Checking DNS for $DOMAIN…"
RESOLVED="$(dig +short "$DOMAIN" | head -n1 || true)"
SERVER_IP="$(curl -s4 https://api.ipify.org || hostname -I | awk '{print $1}')"
if [[ -z "$RESOLVED" ]]; then
  warn "DNS not resolving yet for $DOMAIN — check your DNS provider."
elif [[ "$RESOLVED" != "$SERVER_IP" ]]; then
  warn "DNS resolves to $RESOLVED but this server IP is $SERVER_IP."
  warn "If you're behind Cloudflare, set the record to 'DNS only' (grey cloud) before SSL."
  read -r -p "Continue with SSL anyway? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || { warn "Aborted before SSL"; exit 0; }
else
  ok "DNS points correctly to this server"
fi

# 5) Issue / renew SSL
say "Requesting SSL certificate for $DOMAIN…"
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  ok "SSL certificate installed"
else
  err "Certbot failed. Common causes:"
  err "  • Cloudflare proxy is ON (must be grey cloud during issuance)"
  err "  • DNS hasn't propagated yet — wait a few minutes and retry"
  err "  • Port 80 is blocked at the cloud firewall"
  exit 1
fi

systemctl reload nginx
ok "Done. Visit: https://$DOMAIN"
echo
echo "If you use Cloudflare, you can now:"
echo "  1) Re-enable the proxy (orange cloud) for this record"
echo "  2) Set SSL/TLS mode to 'Full (strict)' in Cloudflare"
