#!/bin/sh
# Entrypoint for Nginx on EC2:
# 1. If a Let's Encrypt certificate already exists for API_DOMAIN, starts directly in HTTPS mode.
# 2. Otherwise starts in HTTP-only mode to serve Certbot's ACME HTTP-01 challenge, then
#    automatically switches to HTTPS and reloads Nginx once the certificate is issued.
# 3. Reloads Nginx every 6 hours so renewed certificates from Certbot are picked up automatically.
set -e

if [ -z "${API_DOMAIN}" ]; then
  echo "ERROR: API_DOMAIN environment variable is not set." >&2
  exit 1
fi

CERT_PATH="/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem"
TARGET_CONF="/etc/nginx/conf.d/default.conf"

render_http_only() {
  cat > "${TARGET_CONF}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${API_DOMAIN};
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
}

render_https() {
  envsubst '${API_DOMAIN}' < /etc/nginx/templates/default.conf.template > "${TARGET_CONF}"
}

if [ -f "${CERT_PATH}" ]; then
  echo "TLS certificate found for ${API_DOMAIN}; starting Nginx with HTTPS."
  render_https
else
  echo "No TLS certificate found yet for ${API_DOMAIN}; starting Nginx in HTTP-only mode for ACME challenge."
  render_http_only
  (
    while [ ! -f "${CERT_PATH}" ]; do
      sleep 5
    done
    echo "TLS certificate detected for ${API_DOMAIN}; enabling HTTPS and reloading Nginx."
    render_https
    nginx -s reload
  ) &
fi

(
  while :; do
    sleep 6h
    if [ -f "${CERT_PATH}" ]; then
      nginx -s reload
    fi
  done
) &

exec nginx -g "daemon off;"
