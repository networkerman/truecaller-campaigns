#!/bin/bash
# Runs on the EC2 host (via SSM). Pulls the given images and restarts the stack.
# Usage: remote-deploy.sh <server-image> <web-image> <region> <site-address>
set -euo pipefail
SERVER_IMAGE=$1 WEB_IMAGE=$2 REGION=$3 SITE_ADDRESS=$4
cd /opt/truecaller

# Secrets live in SSM Parameter Store under /truecaller/*; the DB password is generated once on the box.
[ -f db.env ] || echo "DB_PASSWORD=$(openssl rand -hex 24)" > db.env
param() { aws ssm get-parameter --region "$REGION" --name "/truecaller/$1" --with-decryption --query Parameter.Value --output text 2>/dev/null || true; }

{
  cat db.env
  echo "SERVER_IMAGE=$SERVER_IMAGE"
  echo "WEB_IMAGE=$WEB_IMAGE"
  echo "SITE_ADDRESS=$SITE_ADDRESS"
  echo "API_KEYS=$(param API_KEYS)"
  echo "DASHBOARD_PASSWORD_HASH='$(param DASHBOARD_PASSWORD_HASH)'"
  for k in TC_PROVIDER TC_API_BASE_URL TC_API_KEY TC_SENDER_ID TC_WEBHOOK_SECRET; do
    v=$(param "$k"); [ -n "$v" ] && echo "$k=$v"
  done
} > .env
chmod 600 .env db.env

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${SERVER_IMAGE%%/*}"
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
