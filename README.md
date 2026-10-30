# Denta Kids

Booking website (opened from the clinic's LINE OA), its backend, and the staff
desktop app for **Denta Kids** pediatric dental clinic.

## Where things are

```
src/                     the website + backend (Next.js 16)
  app/                   pages and API routes — patient site, /staff console, /api/*
  components/
    patient/             patient website screens (booking, my bookings, clinic…)
    shared/              icons and the mascot, used by both sites
    staff/               staff console, by area:
      shell/             menu, top bar, sign-in gates, icons
      schedule/          ตารางนัด, booking dialogs, calendars
      patients/          patient file, dental chart, paperwork, recalls
      rooms/             ห้องตรวจ (exam room screen)
      billing/           การเงิน — bills, receipts, PromptPay, day close
      stock/ reports/ chat/ settings/
  server/                database access and server actions (billing, clinical, stock, …)
  lib/                   shared logic and types used by both client and server
  db/                    database schema (Drizzle) and client
  data/  i18n/           built-in content and Thai/English text
apps/
  staff-desktop/         staff app for clinic PCs (Tauri) — queue and full editions
  queue-site/            waiting-room queue screen (plain static site)
deploy/                  run everything on your own VPS (Docker + HTTPS)
scripts/                 seed data, tests, deploy-to-VPS
docs/                    PROJECT notes, DEPLOYMENT guide, diagrams, review, archive
public/                  static files served as-is
```

## Everyday commands

```bash
docker compose up -d          # local database
pnpm dev                      # website + backend on http://localhost:3000
pnpm db:push                  # apply schema changes to the database in .env
pnpm e2e:test                 # booking flow end to end
pnpm concurrency:test         # 30 simultaneous bookings/payments: no doubles
pnpm --dir apps/staff-desktop dev:app       # staff app; edition = STAFF_EDITION of the server it talks to
pnpm deploy:vps root@<ip>     # deploy / update the VPS (see docs/DEPLOYMENT.md)
```

**New here? Start with [docs/OVERVIEW.md](docs/OVERVIEW.md)**: what the system is,
where the code lives, and why it's built this way. For a short version to
give an AI assistant, use [docs/AI_BRIEF.md](docs/AI_BRIEF.md). Design notes with measured
results are in [docs/design/](docs/design/). More: [docs/PROJECT.md](docs/PROJECT.md)
(original plan) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (hosting).
