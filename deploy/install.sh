#!/usr/bin/env bash
set -euo pipefail

# Deploy isolado — NÃO mexe em pokemon-ai, ports 8787/8788, nem nos sites nginx do jogo.

APP_DIR="/var/www/obediencia"
REPO="${REPO:-git@github.com:huras/obediencia-desobediencia.git}"
BRANCH="${1:-main}"
SKIP_GIT="${SKIP_GIT:-0}"
NGINX_SITE="/etc/nginx/sites-available/obediencia.hurast.com"
PRIMARY_HOST="obediencia.hurast.com"

echo "==> Deploying Obediência (branch: ${BRANCH})"

if [ "$SKIP_GIT" != "1" ]; then
  if [ ! -d "$APP_DIR/.git" ]; then
    git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
  else
    cd "$APP_DIR"
    git fetch origin
    git checkout "$BRANCH"
    echo "==> Syncing VPS to origin/${BRANCH}..."
    git reset --hard "origin/${BRANCH}"
  fi
else
  echo "==> SKIP_GIT=1 — mantendo arquivos já sincronizados no VPS"
  mkdir -p "$APP_DIR"
fi

cd "$APP_DIR"
npm install --omit=dev

mkdir -p server/data
touch server/data/.gitkeep

if [ ! -f deploy/nginx-obediencia.hurast.com.conf ]; then
  echo "FAIL: falta deploy/nginx-obediencia.hurast.com.conf no VPS"
  exit 1
fi

cp deploy/nginx-obediencia.hurast.com.conf "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/obediencia.hurast.com

# Se o cert ainda não existe, sobe HTTP temporário só deste host para o ACME.
if [ ! -f "/etc/letsencrypt/live/${PRIMARY_HOST}/fullchain.pem" ]; then
  echo "==> TLS ainda não emitido — config HTTP temporária para ACME..."
  cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PRIMARY_HOST};
    root ${APP_DIR}/public;
    location / { try_files \$uri \$uri/ =404; }
}
EOF
  nginx -t
  systemctl reload nginx

  echo "==> Requesting TLS certificate (certbot)..."
  certbot certonly --nginx \
    -d "$PRIMARY_HOST" \
    --non-interactive --agree-tos -m admin@hurast.com \
    --cert-name "$PRIMARY_HOST" || true

  cp deploy/nginx-obediencia.hurast.com.conf "$NGINX_SITE"
fi

nginx -t
systemctl reload nginx

if pm2 describe obediencia-api >/dev/null 2>&1; then
  # delete+start re-lê deploy/.env via ecosystem.config.cjs
  pm2 delete obediencia-api
fi
pm2 start deploy/ecosystem.config.cjs
pm2 save

echo "==> Done. App: https://${PRIMARY_HOST}"
echo "    (Pokemon / outros sites do VPS não foram alterados)"
