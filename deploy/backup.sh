#!/usr/bin/env bash
# Nightly database backup on the VPS (cron, set up by server-setup.sh).
# Fails loudly instead of quietly: a failed pg_dump must not leave an empty
# file that looks like a backup, and old good backups are only removed when a
# new good one exists — so a week of failures never deletes the last good copy.
#
# These files live on the same disk as the database, so each one is also
# copied off the server when BACKUP_REMOTE is set (see the end).
set -euo pipefail
# the dumps hold patients' names and phone numbers: readable by root only
umask 077
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

# a copy off this server (BACKUP_REMOTE in .env.production, e.g. "gdrive:dentakids"
# after a one-time `rclone config`) — a lost VPS must not take the backups with it
remote=$(grep -E '^BACKUP_REMOTE=' .env.production | cut -d= -f2- | tr -d '"' || true)
if [ -n "$remote" ]; then
  if rclone copy "backups/db-$day.sql.gz" "$remote" >/dev/null 2>&1; then
    echo "$(date -Is) ok: copied off-site to $remote" >> "$log"
    # the off-site folder keeps 60 days
    rclone delete "$remote" --min-age 60d --include 'db-*.sql.gz' >/dev/null 2>&1 || true
  else
    echo "$(date -Is) FAILED: off-site copy to $remote" >> "$log"
    exit 1
  fi
fi
