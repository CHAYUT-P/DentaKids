#!/usr/bin/env bash
# Runs ON the VPS (scripts/deploy-vps.sh sends it). Safe to run again: every
# step checks first, so the same command installs the first time and updates
# after that.
set -euo pipefail
APP=/opt/dentakids
cd "$APP"
say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

# the reminder jobs below are written in UTC (11:00 UTC = 18:00 in Bangkok);
# a server set to Bangkok time would send the morning reminder at midnight
timedatectl set-timezone UTC 2>/dev/null || true

say "1/7  Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

say "2/7  Memory (a 2 GB swap file lets a 1 GB server build the app)"
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "3/7  Firewall (only SSH, HTTP, HTTPS open)"
if iptables -S INPUT 2>/dev/null | grep -q -- "-j REJECT"; then
  # Oracle Cloud images ship iptables rules that reject everything but SSH —
  # let web traffic in ahead of the reject (also open 80/443 in the VCN
  # "security list" in the Oracle console)
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
elif command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

set -a; . ./.env.production; set +a
DC="docker compose -f deploy/docker-compose.yml --env-file .env.production"

say "4/7  Database"
$DC up -d db
# first deploy only: copy the current cloud database (e.g. Neon) across
if [ -n "${COPY_FROM_DATABASE_URL:-}" ] && [ ! -f .db-copied ]; then
  say "     copying data from the old database (one time)…"
  docker run --rm postgres:17-alpine pg_dump --no-owner --no-acl "$COPY_FROM_DATABASE_URL" \
    | $DC exec -T db psql -q -U dental -d dentalweb >/dev/null
  touch .db-copied
fi

say "5/7  Building the app (a few minutes on a small server)"
$DC build app migrate
$DC run --rm migrate </dev/null

say "6/7  Starting"
$DC up -d app caddy
$DC ps

say "7/7  Reminders + nightly backup"
mkdir -p backups && chmod 700 backups
# off-site copies of the backups (optional, see docs/DEPLOYMENT.md): rclone
command -v rclone >/dev/null 2>&1 || curl -fsSL https://rclone.org/install.sh | bash >/dev/null 2>&1 || true
cat > /etc/cron.d/dentakids <<CRON
# LINE reminders — 18:00 and 07:00 Bangkok (the server clock is UTC); called
# inside the app container, so HTTPS redirects never get in the way
0 11 * * * root cd $APP && $DC exec -T app wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" "http://127.0.0.1:3000/api/cron/reminders?kind=day_before" >/dev/null 2>&1
0 0 * * * root cd $APP && $DC exec -T app wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" "http://127.0.0.1:3000/api/cron/reminders?kind=morning" >/dev/null 2>&1
# database backup at 03:00 Bangkok, newest 14 good ones kept (deploy/backup.sh;
# failures go to backups/backup.log and never delete a good backup)
0 20 * * * root $APP/deploy/backup.sh
CRON
chmod 600 /etc/cron.d/dentakids

say "Done"
if [ -n "${DOMAIN:-}" ]; then
  echo "  Website:  https://${DOMAIN}"
  echo "  (the HTTPS certificate is issued on the first visit — give it a minute)"
else
  echo "  Website:  http://$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
fi
docker image prune -f >/dev/null 2>&1 || true
