# Denta Kids — deployment plan

Three user-facing pieces + one backend. One Postgres serves everything.

```
                        ┌──────────────────────────────┐
                        │  Managed Postgres            │
                        │  (Neon / Supabase / RDS)     │
                        └──────────────▲───────────────┘
                                       │
                        ┌──────────────┴───────────────┐
                        │  Main deploy — Next.js       │
                        │  dentalweb (this repo)       │
                        │                              │
                        │  · patient LIFF pages  /     │
                        │  · staff console       /staff│
                        │  · Server Actions + /api     │
                        └───────▲───────────▲──────────┘
                                │           │
            LINE LIFF opens ────┘           └──── Tauri shell loads /staff
            https://…/                        (apps/staff-desktop)

   queue-check site (apps/queue-site/) — static files on any static host
   polls https://<main-deploy>/api/queue — different domain, different host
```

## Pieces

| Piece | What it is | Where it lives | Who hosts it |
|---|---|---|---|
| **Patient web + backend** | This Next.js app: LIFF pages, `/staff` console, Server Actions, `/api/queue` | This repo | One deploy — Vercel (easiest) or a VPS/Thai host |
| **Postgres** | The single source of truth | Managed service | Neon or Supabase free tier to start |
| **Staff desktop app** | Tauri shell loading `https://<deploy>/staff` | `apps/staff-desktop` | No hosting — shipped as an installer |
| **Queue-check site** | Plain static HTML/JS, polls `/api/queue` | `apps/queue-site/` | Any static host — Netlify, GitHub Pages, Thai shared hosting |

## Why this shape

- **LINE OA hosts nothing.** LIFF just opens a URL — the patient web must live at a public HTTPS address we control. During dev that's a tunnel (cloudflared/ngrok).
- **The desktop app is a window, not a second system.** Staff data already lives in Postgres; the Tauri shell loads the same `/staff` console the browser would. No duplicate logic, no sync layer. Trade-off accepted: it's a webview, not native widgets — fine for a scheduling console.
- **The queue site is deliberately separate and dumb.** Parents check it on their phones in the waiting room (QR code on the desk). It must load fast on bad clinic wifi, must not require login, and must not take the main app down with it — a static page polling one public JSON endpoint is all of that.
- **`/api/queue` is the only public surface the queue site needs.** It returns refs + first names only — no phones, no guardian names. CORS is open (`*`) because the data is what a waiting-room board already shows.

## Before any public deploy — blockers

1. **Staff auth.** `/staff` currently has none. A public deploy makes it reachable by URL — patient data + the ability to cancel bookings, unauthenticated. The Tauri app does not change this; it just wraps the URL. Required first: clinic credentials (staff_user table is already sketched in the schema doc).
2. **LINE credentials** (held by the owner's aunt): LIFF channel + Messaging API channel **under the same provider**, else login `userId` won't match push-message `userId`. Until then patient identity is a typed phone number.
3. **PDPA.** Records are about minors. The public `/api/queue` deliberately exposes only ref code + child display name — same information a clinic whiteboard shows. Decide retention/consent wording before launch.

## Steps to production

```
1. Create managed Postgres (Neon/Supabase) → copy DATABASE_URL
2. Deploy this repo (Vercel): set env DATABASE_URL (+ later LINE_*)
   → run `pnpm db:push` against it once
3. Verify https://<deploy>/staff loads, /api/queue returns JSON
4. Queue site: edit apps/queue-site/config.js → QUEUE_API = https://<deploy>
   → upload the apps/queue-site/ folder to the static host → print QR to it
5. Staff app: pnpm --filter staff-desktop build with
   --config '{"build":{"frontendDist":"https://<deploy>/staff"}}'
   → installer for the front-desk PC (Windows) or this Mac
6. When LINE credentials arrive: set LIFF ID/secret + channel token in env,
   swap the mock for the real client (one file), point the LIFF endpoint
   in the LINE console at https://<deploy>
```

## Local dev (unchanged)

```
docker compose up -d     # Postgres 16
pnpm db:push && pnpm db:seed
pnpm dev                 # → http://localhost:3000

pnpm --filter staff-desktop dev    # Tauri window on http://localhost:3000/staff
open apps/queue-site/index.html              # or any static server; config.js points at :3000
```

## Hosting on your own VPS (one command)

Everything runs on one server with Docker: Postgres, the app, and Caddy
(automatic HTTPS). Files live in `deploy/`.

1. Rent an Ubuntu 24.04 VPS (1 GB RAM is enough; the script adds swap), note
   its IP, make sure you can `ssh root@<ip>`.
2. Point your domain's DNS **A record** at that IP (e.g. `booking.yourclinic.com`).
3. On this Mac: `pnpm deploy:vps root@<ip>` — the first run creates
   `deploy/.env.production`; fill it in (domain, a database password, STAFF_PIN,
   CRON_SECRET, LINE keys, and `COPY_FROM_DATABASE_URL` = the Neon URL to bring
   the current data across once). Run the same command again.
4. It installs Docker, a swap file and a firewall, copies the old database,
   builds and starts everything, applies schema changes, and sets the daily
   LINE reminders (18:00 / 07:00) and a nightly database backup
   (`deploy/backup.sh` → `/opt/dentakids/backups`, newest 14 good copies;
   results in `backups/backup.log`). **These sit on the same disk as the
   database**, so also copy them off the server (e.g. a weekly download to the
   clinic PC, or `rclone` to Google Drive / Cloudflare R2), and try restoring
   one once (`gunzip -c db-….sql.gz | psql`) so you know it works.
5. Point LINE at the new address: LIFF endpoint `https://<domain>/` and webhook
   `https://<domain>/api/line/webhook`. Rebuild the staff app with
   `VITE_API_URL=https://<domain>`.

Updating later is the same command — it sends the code on this Mac, rebuilds,
and applies schema changes.

### Trying it for free first

- **Server:** Oracle Cloud "Always Free" (Singapore region), an Ampere ARM VM with
  Ubuntu. Before deploying, add ingress rules for TCP 80 and 443 in the VCN's
  security list. The script opens Oracle's own iptables rules itself. Deploy with
  `pnpm deploy:vps ubuntu@<ip>`; non-root logins use sudo automatically.
- **Address:** there is no need to buy a domain to try it. Set
  `DOMAIN=<ip-with-dashes>.sslip.io` (e.g. `140-245-12-34.sslip.io`) and Caddy
  still gets a real HTTPS certificate.
- The trial copies the data from Neon once (`COPY_FROM_DATABASE_URL`) and does
  not touch the live Vercel site. LINE keeps pointing at Vercel until you change
  the LIFF endpoint and webhook URL.
- **For real use, buy a domain** (e.g. `dentakids.co.th` or `.com`, about
  300–1,000 ฿/yr). Point an "A" record at the server's IP, set `DOMAIN=` to it,
  and run the deploy command again.
