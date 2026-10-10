#!/usr/bin/env bash
# Run once on the box. Creates /etc/truecaller-campaigns.env with fresh random secrets.
# Never overwrites an existing file, and prints no secret values.
set -euo pipefail
ENV=/etc/truecaller-campaigns.env
if [ -f "$ENV" ]; then echo "$ENV already exists, leaving it alone"; exit 0; fi
pw=$(openssl rand -hex 24)
key="tck_setup_$(openssl rand -hex 20)"
umask 077
sudo tee "$ENV" >/dev/null <<EOT
DOMAIN=${DOMAIN:-truecaller.udchowdhury.me}
POSTGRES_PASSWORD=$pw
DATABASE_URL=postgres://postgres:$pw@db:5432/truecaller
API_KEYS=$key
TC_PROVIDER=mock
TC_API_BASE_URL=
TC_API_KEY=
TC_SENDER_ID=
TC_WEBHOOK_SECRET=
EOT
sudo chmod 600 "$ENV"
echo "created $ENV. Read the sign-in key with: sudo grep API_KEYS $ENV"
