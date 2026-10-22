# Denta Kids: project overview

*Start here. This is what the system is, how the pieces fit, where the code
lives, and why it's built this way. Last updated 2026-10-23.*

## 1. What it is

**Denta Kids** is a children's dental clinic in Chonburi. This repository is
the clinic's own booking system. It's in **real use**, replacing a phone-and-paper
booking process and, step by step, the clinic's old desktop program (FD by 9net).

| Who | Uses | What they do |
|---|---|---|
| Families | **Patient website**, opened from the clinic's LINE Official Account | Book a visit (kid or adult → treatment → dentist → day and time → name + phone), see, move or cancel their bookings, read the clinic's messages |
| Front desk, dentists | **Staff app** (Windows/Mac desktop app) | Today's queue, the schedule (drag to move), walk-ins, settings (dentists, hours, treatments, prices) |
| Families (automatic) | **LINE messages** | Booking confirmation, reminder the day before (18:00) and the morning of (07:00) |

Live today: the patient website and the **queue edition** of the staff app.
The **full edition** (billing, patient files and dental chart, stock, reports)
is built and will roll out later.

## 2. How it fits together

```
 Family's phone (LINE app)            Clinic PCs (Windows)
   │  LIFF web page                     │  Denta Kids Staff (Tauri app)
   ▼                                    ▼
 ┌──────────────────────────────────────────────────────────┐
 │  One Next.js 16 app (Vercel today; VPS scripts ready)    │
 │   · patient pages  /, /book, /bookings, /clinic …        │
 │   · server actions  src/server/actions.ts                │
 │   · staff API       POST /api/staff (bearer PIN)         │
 │   · LINE webhook    /api/line/webhook                    │
 │   · reminders cron  /api/cron/reminders (Vercel Cron)    │
 └───────────────┬──────────────────────────────────────────┘
                 ▼
          PostgreSQL (Neon today) via Drizzle ORM, 44 tables
                 │
                 └── LINE Messaging API (push confirmations and reminders)
```

**One app, one deploy.** The website, its backend and the staff API are the
same Next.js project. The desktop app is a thin shell around the **same React
screens**, built separately with Vite, and talks to `/api/staff`.

## 3. Where the code is

```
src/
  app/                    Next.js routes: patient pages, /staff (web console), /api/*
    api/staff/route.ts    the staff app's API: one POST, maps an action name → server function
    api/staff/events      live updates for the staff screens (Server-Sent Events)
    api/queue, api/display, api/cron/reminders, api/line/webhook, api/dentist-photo, api/health
  components/
    patient/              patient website screens (BookingFlow.tsx is the booking flow)
    staff/                staff screens by area: shell/ schedule/ settings/ patients/ billing/ …
    shared/               icons, mascot
  server/                 everything that touches the database
    actions.ts            every action the screens call ("use server"), with auth guards
    queries.ts            bookings, slots, dentists, treatments, settings
    billing.ts            bills, payments, receipts (full edition)
    clinical.ts, stock.ts, reports.ts, chat.ts, users.ts, line.ts, staffAuth.ts
  lib/                    shared logic, no database: dates, slots (durations), ageGroup,
                          idempotency, staffStore (staff app state), useLine (LINE sign-in)
  db/schema.ts            the whole database schema (Drizzle), the single source of truth
  i18n/dict.ts            Thai/English text for the patient site
apps/
  staff-desktop/          Tauri 2 desktop app. src/api.ts replaces server actions with HTTP calls
  queue-site/             tiny static waiting-room page
deploy/, scripts/deploy-vps.sh   run everything on your own server (Docker + Caddy HTTPS)
scripts/                  seed data and the test suites (see §6)
.github/workflows/        builds the Windows installer on GitHub
docs/                     this file, design notes (docs/design/), deployment guide
```

## 4. Key decisions, and why

| Decision | Why | Trade-off |
|---|---|---|
| **One Next.js app** for website + backend + staff API | One codebase, one deploy, types shared end to end. A clinic doesn't need microservices. | Everything scales together (fine at this size). |
| **PostgreSQL + Drizzle ORM** | Real constraints (unique indexes, transactions, locks) are what keep bookings correct. Drizzle gives typed queries with the schema in code (`pnpm db:push`). | Schema changes must reach the live DB before the code. Order matters on deploy. |
| **LINE (LIFF) sign-in as the patient's identity** | Families already use the clinic's LINE OA. No passwords. A phone number is guessable and isn't proof. | Patient features need the LINE Login channel **published**. |
| **Booking = nickname + phone only** | Fast for parents. Staff match bookings to records themselves. | Less data up front. |
| **30-minute grid; treatments have a length** (30 min–4 h) | A 1-hour treatment holds every half-hour it covers. The patient site, server and staff screens share one helper (`src/lib/slots.ts`). | Times stay on the half-hour grid. |
| **Hold, then confirm** | Picking a time reserves it for 10 minutes while the family types their name. | Holds are a courtesy. The guarantee is enforced at confirm. |
| **Correctness under concurrency** (unique index + day lock + idempotency keys) | See [design/01](design/01-no-double-booking.md). Measured before/after with 30 simultaneous requests. | Same-day bookings wait a few ms for each other. |
| **Tauri for the desktop app** (not Electron) | ~3 MB installer instead of ~100 MB. Uses the system webview. Rust side reads Thai ID cards (PC/SC). | Needs a Windows machine (GitHub Actions) to build Windows installers. |
| **Two editions** (queue / full) | The clinic moves off its old system gradually; the queue edition stays small and stable. | New full-edition features are gated with `edition === "full"`. |
| **Every staff action goes through `guard()`**; staff API needs the clinic PIN | The website is public. Staff data must not be. | One shared PIN today; per-person accounts exist in the full edition. |
| **Real data only** | The site shows exactly what is in the database: no demo fallbacks, no fake settings. | Empty fields show "–" until the clinic fills them in. |
| **Dentist photos stored in the database**, served from a cached URL | No extra storage service to run. Pages never carry image data inline. | Fine for a handful of photos, not for thousands of images. |
| **Vercel + Neon now, VPS ready** | Free and zero-ops while starting. `pnpm deploy:vps` moves everything to one server when cost or control matters. | — |

## 5. What families and staff can do (feature list)

- **Website:** kid/adult → treatment → dentist (or "any dentist") → calendar
  (as far ahead as the clinic allows, up to a year; closed days, dentist leave
  and full days greyed out) → time → name + phone →
  booked, with a LINE confirmation. My bookings (via LINE), move or cancel with
  a confirm step, the clinic's messages (bell), dentist profiles with photos,
  services with show/hide prices, clinic page with hours, phone and map. Thai
  and English.
- **Staff (queue edition):** วันนี้ (today's queue: check-in, call in, done),
  ตารางนัด (schedule by dentist; **drag a booking to move it**, with a LINE
  notice option; 1-hour bookings show as a range), walk-ins, new appointment,
  appointment details (move, cancel, message the family),
  ตั้งค่า (settings): dentists (photos, treatments with kids/adults per
  treatment, weekly hours, leave), services (price, show/hide price, length),
  opening hours and holidays, chairs, how far ahead families may book, clinic
  info.
- **Full edition (built, not live yet):** cashier and receipts (PromptPay,
  deposits, insurance claims, doctor fees), patient file and dental chart,
  treatment plans and signatures, stock and labs, reports, LINE chat inbox,
  staff accounts and audit log.

## 6. Tests

| Command | What it proves | Size |
|---|---|---|
| `pnpm e2e:test` | The whole booking flow end to end: book, see, staff assign, double-booking refused, kids/adults rules, 1-hour treatments, cancel, booking window, batched availability | 48 checks |
| `pnpm db:test` | Database behaviour: seed, slots, holidays, holds, queue, walk-ins | 28 checks |
| `pnpm concurrency:test` | 30 simultaneous bookings and payments: no double booking, no overpayment, retries are safe | 15 checks |
| `pnpm test` | Unit tests: billing maths, Thai baht text, PromptPay QR, slots, age rules | 16 tests |
| `pnpm load:test <scenario>` | k6 over real HTTP against a production build: spikes on one slot, rate limit, a promotion-sized rush, the limit of one server ([design/05](design/05-load-test.md)) | 6 scenarios, run by hand |
| `pnpm bench:live` | Live updates: how fast a save reaches other screens, idle traffic vs polling ([design/04](design/04-live-updates.md)) | run by hand |
| `pnpm typecheck`, `pnpm lint` | Types and lint across the website, backend and desktop app | — |

The database tests run against the **local** database (`docker compose up -d`).
The concurrency test refuses to run anywhere else. **All of it runs
automatically on GitHub for every push** ([design/02](design/02-ci.md)).

## 7. Running it

```bash
pnpm install
docker compose up -d                 # local Postgres
pnpm db:push && pnpm db:seed         # schema + demo data
pnpm dev                             # website + backend → http://localhost:3000
pnpm --dir apps/staff-desktop dev    # staff app UI in a browser (queue edition) → :5173
```

**Deploying:** push to `main` and Vercel deploys the website. **Before**
pushing code that adds database columns, run `DATABASE_URL=<live> pnpm db:push`
(additive changes only), otherwise the live site breaks. The Windows staff app
is built on GitHub: Actions → *Staff app (Windows)* → Run workflow → install
the `.exe` from Releases on each PC.

## 8. Reliability roadmap

| Step | Status | Note |
|---|---|---|
| 1. No double booking / no double charge (locks + idempotency) | ✅ Done | [design/01](design/01-no-double-booking.md) |
| 2. CI: tests and checks on every push, billing-math unit tests | ✅ Done | [design/02](design/02-ci.md) |
| 3. Monitoring: error tracking + uptime alerts | ✅ Done | [design/03](design/03-monitoring.md). Owner setup: `ALERT_LINE_USER_ID` + UptimeRobot |
| 4. Live updates instead of 20-second polling | ✅ Done | [design/04](design/04-live-updates.md). A save shows on other screens in ~0.1 s instead of 10 s; idle traffic 566 MB/h → 2.4 KB/h per screen |
| 5. HTTP load test (k6) | ✅ Done (local) | [design/05](design/05-load-test.md). 200 families on one slot → 1 booking, 0 errors. Next: run it against a staging copy |
| 6. Fix what the measurements found: availability in one batch, slimmer staff download, booking window up to a year | ✅ Done | [design/06](design/06-faster-availability.md). One server: ~30 → ~60 families/s at p95 < 60 ms; staff download 3.2 MB → 0.5 MB |

## 9. Things to know before changing anything

- **The clinic uses this for real.** Test locally (`pnpm e2e:test`,
  `pnpm concurrency:test`) before pushing. Never run tests or seeds against the
  live database.
- **Schema first, code second** on deploy (see §7).
- **Inside a database lock, read only through the transaction (`tx`)**, never
  the shared pool. Otherwise it can deadlock under load (design/01).
- **Queue edition stays simple.** Put full-edition features behind
  `edition === "full"`.
- **Real data only.** No placeholder content on anything a family or staff
  member sees.
- Commit messages explain *why*. Read `git log` for the history of any feature.
