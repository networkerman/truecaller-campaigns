#!/usr/bin/env bash
# Deploys the current checkout to the box: rsync, then rebuild and restart the containers.
# Usage: SSH_KEY=~/.ssh/truecaller-campaigns.pem ./deploy/push.sh ubuntu@<ip>
set -euo pipefail
HOST=${1:?usage: push.sh ubuntu@<ip>}
KEY=${SSH_KEY:-$HOME/.ssh/truecaller-campaigns.pem}
DIR=/opt/truecaller-campaigns
cd "$(dirname "$0")/.."

rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude .git --exclude node_modules --exclude dist --exclude infra --exclude local --exclude .env \
  ./ "$HOST:$DIR/"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" "cd $DIR/deploy && sudo docker compose up -d --build --remove-orphans && sudo docker image prune -f >/dev/null"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" "cd $DIR/deploy && sudo docker compose ps --format 'table {{.Service}}\t{{.Status}}'"
