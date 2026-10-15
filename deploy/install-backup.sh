#!/usr/bin/env bash
# Run once on the box: schedules deploy/backup.sh at 02:30 IST (21:00 UTC) every night.
set -euo pipefail
echo '0 21 * * * root /opt/truecaller-campaigns/deploy/backup.sh >> /var/log/truecaller-backup.log 2>&1' | sudo tee /etc/cron.d/truecaller-backup >/dev/null
sudo chmod 644 /etc/cron.d/truecaller-backup
echo "installed /etc/cron.d/truecaller-backup"
