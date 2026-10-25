#!/usr/bin/env bash
# Run ONCE on the VPS, right before the clinic tells families about the
# system: removes the test bookings, patients, bills and history made while
# trying it out, and keeps the clinic's setup (see clear-test-data.sql for
# exactly what goes and what stays).
#
#   bash deploy/clear-test-data.sh
#
# It shows what is in the database, asks you to type CLEAR, and saves a
# backup first (backups/before-clear-….sql.gz) — so a mistake can be undone:
#   gunzip -c backups/before-clear-….sql.gz | docker compose -f deploy/docker-compose.yml \
#     --env-file .env.production exec -T db psql -U dental -d dentalweb
# (into an empty database).
set -euo pipefail
# the backup holds patients' names and phone numbers: readable by root only
umask 077
cd "$(dirname "$0")/.."

DC="docker compose -f deploy/docker-compose.yml --env-file .env.production"
PSQL="$DC exec -T db psql -U dental -d dentalweb -v ON_ERROR_STOP=1"

echo "What is in the database now:"
$PSQL -At -F ' ' <<'SQL'
select rpad('bookings', 22), count(*) from appointment
union all select rpad('walk-ins', 22), count(*) from waitlist_entry
union all select rpad('families', 22), count(*) from guardian
union all select rpad('patients', 22), count(*) from child
union all select rpad('bills', 22), count(*) from invoice
union all select rpad('booking history rows', 22), count(*) from visit_event
union all select rpad('-- kept: dentists', 22), count(*) from dentist
union all select rpad('-- kept: treatments', 22), count(*) from treatment
union all select rpad('-- kept: staff accounts', 22), count(*) from staff_user;
SQL

echo
echo "This deletes every booking, walk-in, patient, bill and history row above."
echo "Dentists, treatments, hours, holidays, settings and staff accounts stay."
read -r -p "Type CLEAR to go ahead (anything else stops): " answer
if [ "$answer" != "CLEAR" ]; then
  echo "Stopped. Nothing was deleted."
  exit 1
fi

mkdir -p backups
backup="backups/before-clear-$(date +%F-%H%M).sql.gz"
$DC exec -T db pg_dump -U dental dentalweb | gzip > "$backup"
echo "Backup saved: $backup"

$PSQL < deploy/clear-test-data.sql
echo "Done. Test data cleared — the system is ready for real bookings."
