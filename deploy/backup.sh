#!/usr/bin/env bash
# Nightly database backup on the VPS (cron, set up by server-setup.sh).
# Fails loudly instead of quietly: a failed pg_dump must not leave an empty
# file that looks like a backup, and old good backups are only removed when a
# new good one exists — so a week of failures never deletes the last good copy.
#
# These files live on the same disk as the database. Copy them somewhere
# else too (see docs/DEPLOYMENT.md) — a lost server takes this folder with it.
set -euo pipefail
cd "$(dirname "$0")/.."

DC="docker compose -f deploy/docker-compose.yml --env-file .env.production"
KEEP=14
mkdir -p backups
day=$(date +%F)
tmp="backups/.db-$day.sql.gz.part"
log=backups/backup.log

if ! $DC exec -T db pg_dump -U dental dentalweb | gzip > "$tmp"; then
  echo "$(date -Is) FAILED: pg_dump" >> "$log"
  rm -f "$tmp"
  exit 1
fi
# a real dump of this database is never this small
size=$(wc -c < "$tmp")
if [ "$size" -lt 2000 ]; then
  echo "$(date -Is) FAILED: dump only $size bytes" >> "$log"
  rm -f "$tmp"
  exit 1
fi
mv "$tmp" "backups/db-$day.sql.gz"
echo "$(date -Is) ok: db-$day.sql.gz ($size bytes)" >> "$log"

# keep the newest $KEEP good backups
ls -1t backups/db-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
