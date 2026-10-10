#!/usr/bin/env bash
# Nightly Postgres backup to S3. Installed by deploy/install-backup.sh as a root cron job.
# Uses the box's IAM role (truecaller-campaigns-box), which can only write under db/ in the bucket.
# The bucket deletes backups after 30 days.
set -euo pipefail
BUCKET=${BACKUP_BUCKET:-truecaller-campaigns-backups-902785551204}
DIR=/opt/truecaller-campaigns/deploy
FILE=/var/backups/truecaller-$(date -u +%Y%m%dT%H%M%SZ).sql.gz

mkdir -p /var/backups
cd "$DIR"
docker compose exec -T db pg_dump -U postgres -d truecaller --no-owner | gzip > "$FILE"
# Host network so the container can reach the instance metadata service for the role's credentials.
docker run --rm --network host -v /var/backups:/var/backups amazon/aws-cli:2.31.21 \
  s3 cp "$FILE" "s3://$BUCKET/db/$(basename "$FILE")" --only-show-errors
rm -f "$FILE"
echo "$(date -u +%FT%TZ) backed up $(basename "$FILE")"
