# Denta Kids: project guide

*Start here. What the system is, how every part works, what each file does,
how to run, test and ship it, and the rules for changing it. Last updated
2026-10-25.*

Deeper reading: the design notes in [`docs/design/`](design/) (01–07, each with
measured before/after numbers), [`DEPLOYMENT.md`](DEPLOYMENT.md) for servers,
and [`PROJECT.md`](PROJECT.md) for the early product decisions.

---

## 1. What it is

**Denta Kids** is a children's dental clinic in Chonburi. This repository is
its own booking system, replacing phone-and-paper booking and, step by step,
the clinic's old desktop program (FD).

| Who | Uses | For |
|---|---|---|
| Families | **Patient website**, opened from the clinic's LINE Official Account (a LIFF app) | Book a visit, see / move / cancel their bookings, read the clinic's messages |
| Front desk, dentists | **Staff app**: a Windows/Mac desktop app (Tauri) | Today's queue, the schedule, walk-ins, settings |
| Families (automatic) | **LINE messages** | Confirmation, reminders (day before 18:00, morning 07:00), cancel / move notices |
| Waiting room | **Queue board** (`apps/queue-site`, static) | Who is in the chair, who is next |

**Status:** built and tested, **not live yet**. Real use starts on a VPS
(own server, own Postgres). Today's Vercel + Neon deployment is a test site
only, with nothing in it worth keeping. Launch = patient website + the staff
app's **queue edition**. The **full edition** (cashier, patient files, dental
chart, stock, reports, LINE chat) is built but switched off until later.

---

## 2. How the pieces fit

```
 Family's phone (LINE app)        Clinic PCs (Windows)            Waiting-room screen
   │ LIFF web page                  │ Denta Kids Staff (Tauri)        │ apps/queue-site
   ▼                                ▼                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  ONE Next.js 16 app  (VPS in production: Docker + Caddy HTTPS)              │
 │   patient pages   /, /book, /bookings, /dentists, /services, /clinic …     │
 │   server actions  src/server/actions.ts   ← the website calls these        │
 │   staff API       POST /api/staff {action,args}  ← the desktop app         │
 │   live updates    GET /api/staff/events  (Server-Sent Events)              │
 │   LINE webhook    /api/line/webhook        reminders  /api/cron/reminders   │
 │   public          /api/queue, /api/health, /api/client-error, photos       │
 └──────────────┬───────────────────────────────────────┬──────────────────────┘
                ▼                                       ▼
        PostgreSQL 16 (Drizzle ORM, 45 tables)     LINE Messaging API + LINE Login
        LISTEN/NOTIFY → live updates               (push messages, ID-token check)
```

- **One app, one deploy.** Website, backend and staff API are the same
  Next.js project, sharing types end to end.
- **The desktop app is a thin shell** around the *same React screens* as the
  web console (`src/components/staff/**`), built with Vite. Its
  `apps/staff-desktop/src/api.ts` stands in for the server actions and calls
  `POST /api/staff` instead.
- **One staff app for both editions.** The server says `queue` or `full`
  (`STAFF_EDITION`); every PC follows on its next restart, with no reinstall.

---

## 3. Tech stack, and why

| Piece | Choice | Why |
|---|---|---|
| Web + backend | **Next.js 16** (App Router, server actions, route handlers), React 19, TypeScript | One codebase, one deploy, types shared end to end. Note: Next 16 differs from older versions; read `node_modules/next/dist/docs/` before using an API. |
| Database | **PostgreSQL 16** + **Drizzle ORM** (`postgres` driver) | Real constraints (unique indexes, transactions, advisory locks) are what keep bookings correct. Schema lives in code (`src/db/schema.ts`). |
| Patient identity | **LINE LIFF** (ID token verified with LINE) | Families already use the clinic's LINE OA. No passwords. A phone number is guessable, so it's never proof. |
| Desktop app | **Tauri 2** (Rust shell + system webview) | ~3 MB installer instead of ~100 MB (Electron). Rust side reads Thai ID cards (PC/SC) for the full edition. |
| Desktop updates | Tauri **updater** plugin, signed builds on GitHub Actions | Staff tap "อัปเดตตอนนี้"; no visits to the clinic (design/07). |
| Live updates | **Server-Sent Events** + Postgres **LISTEN/NOTIFY** | Saves show on other screens in ~0.1 s; no Redis or message bus to run (design/04). |
| Hosting | **VPS**: Docker Compose (app + Postgres) behind **Caddy** (automatic HTTPS) | Cheap, under the clinic's control. Vercel + Neon only for testing. |
| Monitoring | Own error log (`error_event`) + **LINE alerts** + `/api/health` + UptimeRobot | No extra service; alerts land on the owner's phone (design/03). |
| CI | **GitHub Actions**: types, lint, unit tests, Postgres integration tests, production build | Nothing broken reaches the clinic (design/02). |
| Load testing | **k6** (in Docker) against a production build | Measured limits, not guesses (design/05, 06). |

---

## 4. How it works

### 4.1 A family books

1. **Opens the site from LINE.** `src/lib/useLine.ts` starts LIFF and gets an
   **ID token** (who this LINE user is). Outside LINE, the page shows a "sign
   in with LINE" card.
2. **`/book`** (`src/app/book/page.tsx`) is rendered on the server with
   everything the calendar needs: dentists, opening days, holidays, booking
   rules and **availability for the first 3 weeks**, worked out by
   `slotsForDates()` in one batch of ~7 queries (design/06). Later months load
   when opened (`bookingAvailability` action).
3. **`BookingFlow.tsx`** walks the steps:
   1. kid or adult
   2. treatment
   3. dentist, or "any dentist", each showing their next free time and working days
   4. day and time: only bookable ones, after the book-before rule and the window
   5. name + phone (+ an optional note and a "ปวด/ฉุกเฉิน" tick)
4. **Tapping a time holds it** for 10 minutes (`holdSlot` → `createHold`):
   only with a verified LINE account, **one hold per account** (a new pick
   releases the old one). Holds make the time look taken to everyone else.
5. **Confirm → `bookAppointment`** (`src/server/actions.ts`):
   1. A repeated request with the same **idempotency key** gets the first
      booking back (a double tap or retry never books twice).
   2. Rate limit, then validation: a real date, `:00`/`:30`, phone digits,
      kid/adult required, a treatment shown online.
   3. The LINE token is verified, then the hold is released.
   4. **`slotVerdict`** applies every rule on the server: the booking window,
      book-before hours, dentist on shift and free for the whole treatment
      (or, for "any dentist", a free chair and a capable dentist).
   5. **`createAppointment`** (`src/server/queries.ts`) inside a transaction
      with a **per-day advisory lock**; a **partial unique index** on
      (dentist, date, time) is the last line of defence (design/01).
   6. **`settlePool`** assigns a waiting "any dentist" booking when chairs fill.
   7. A **LINE confirmation** is pushed; **`notifyChange()`** tells every open
      staff screen (§4.4).
6. **My bookings** (`/bookings`, `BookingsPage.tsx`) and the **home page slip**
   (`NextBookings.tsx`) list the family's bookings by LINE account. Moving uses
   `rescheduleBooking` → `moveAppointmentGuarded` (re-reads under both days'
   locks). Cancelling uses `cancelBooking`. Both are allowed only until the
   clinic's **cancel-before** hours; after that the page offers to call the
   clinic. A cancel sends a LINE confirmation.

**"Any dentist" (the pool):** such bookings have `dentist_id = NULL` and
take a chair, not a dentist. They're admitted while live bookings at that time
stay under the **chair count**. Staff (or `settlePool`) assign a dentist later.

**Booking rules** the clinic sets (`src/lib/bookingRules.ts`, stored in
`clinic_setting`, enforced on the server):

| Rule | What it does |
|---|---|
| Window | How far ahead families may book: 1 week up to 1 year |
| Book-before | Hours of notice needed: 0–168, default 1 |
| Cancel-before | Hours before the visit when online changes stop: 0–168, 0 = until the visit |

Staff can always book, move and cancel anything from the staff app.

### 4.2 Treatments, durations and slots

- The day is a **30-minute grid**. A treatment has a length (`durationMin`);
  a 1-hour one **holds every half-hour it covers** (`coveredTimes` in
  `src/lib/slots.ts`, shared by website, server and staff app).
- Bookable times = inside the **dentist's shift** *and* the **clinic's
  opening hours**, on the shift's half-hour grid. Opening hours and shifts
  only accept `:00`/`:30`.
- Dentists tick which treatments they do, and for **kids, adults or both**
  (`src/lib/ageGroup.ts`); families only see dentists who fit.

### 4.3 The staff app

- **Sign-in:** the clinic PIN → `POST /api/staff/login` → a bearer token
  (`src/server/staffAuth.ts`). It's capped at 5 tries per 10 minutes per
  address, and 100 wrong PINs per hour clinic-wide. Every staff action passes **`guard()`**.
  Per-person accounts exist for the full edition.
- **Data:** `staffBootstrap` sends one download containing:
  - appointments from **30 days back** and everything ahead (plus anything
    changed in the last day)
  - dentists, opening days, holidays, booking rules
  - the walk-in queue, notifications, edition

  Older history loads once, on demand (`staffAppointmentsBefore`), for search,
  past lists and patient files.
- **State:** `src/lib/staffStore.tsx` holds it all. Every save goes through
  `mutate()`: call the server, then re-download. A save counts as done once
  the server says so; a failed save reloads real values. Stale downloads
  never roll the screen back, and the screen rolls over at midnight.
- **Screens, queue edition** (3 rail items; don't add more):
  - **วันนี้:** today's queue, check-in, walk-ins, red "ปวด/ฉุกเฉิน" tags
  - **ตารางนัด:** the dentists × times grid, drag to move (the family hears
    on LINE only after the move saves)
  - **ตั้งค่า:** dentists, treatments and prices, hours, holidays, chairs,
    booking rules, clinic info, system status
- **New / moved appointments** use the **time picker** (`SlotPicker.tsx`,
  rules in `src/lib/staffAvailability.ts`). It shows a day strip with free
  counts, then a grid of time × dentist. Staff may book outside a dentist's
  shift while the clinic is open ("นอกเวร", with a warning). The picker
  blocks leave days, existing bookings and past times.
- **Full edition** (off until later): cashier and receipts (PromptPay QR,
  deposits, claims, doctor fees), patient file + dental chart, treatment plans
  and signatures, room screens, stock and labs, reports, LINE chat, staff
  accounts, audit log. Screens check `edition === "full"`.

### 4.4 Live updates

Every staff-visible save calls `revalidateStaff()` → **`notifyChange()`**
(`src/server/changes.ts`): bump `clinic_setting.change_seq` and
`NOTIFY dk_changes`.
- **Server side:** each server instance keeps one `LISTEN` connection and
  pushes `change <n>` down **`/api/staff/events`** (SSE) to every open screen.
- **Screen side:** each screen re-downloads when `n` is newer than what it has
  (`src/lib/staffEvents.ts`).
- **If anything breaks:** a watchdog re-announces missed changes; if streams
  fail, screens fall back to polling every 20 s; `STAFF_LIVE_UPDATES=off`
  forces polling.

### 4.5 LINE

- **Patient identity:** the LIFF ID token is verified with LINE (`patientIdentity`).
- **Push messages** (`src/server/line.ts`): booking confirmations, moves,
  cancels, and staff "message the family". These count against the OA's
  monthly quota.
- **Reminders:** `/api/cron/reminders?kind=day_before|morning`. Cron runs at
  11:00 / 00:00 UTC (18:00 / 07:00 Bangkok). Each send takes a lock and is
  logged in `message_log`, so it's never sent twice. The morning run also
  cleans old rate-limit rows, holds and errors.
- **Webhook** `/api/line/webhook`: verifies the signature and stores incoming
  messages (for the bell page and the full-edition chat). Replies with your
  LINE user id when you send `myid` (for `ALERT_LINE_USER_ID`).

### 4.6 Monitoring

- **What's recorded:** server errors (`src/instrumentation.ts`), staff-API
  errors, and browser crashes (`/api/client-error`). They're grouped by
  fingerprint in `error_event`.
- **Alerts:** new *server* errors send a LINE alert to `ALERT_LINE_USER_ID`,
  capped at 10 per hour and 20 per day. Browser-reported errors never alert:
  anyone can post them, and alerts spend the OA's message quota.
- **Health:** `/api/health` checks the database, for UptimeRobot.
- **In the app:** staff see recent errors under ตั้งค่า → สถานะระบบ.

### 4.7 The desktop app and its updates

- `apps/staff-desktop/` = Vite + React (`src/App.tsx`, `src/api.ts`) inside
  Tauri (`src-tauri/`: `lib.rs`, `idcard.rs`, `tauri.conf.json`).
- **Releasing:** run *Staff app (Windows)* on GitHub Actions. It signs the
  build and publishes the installer to the **public** repo
  `CHAYUT-P/DentaKids-releases`, then writes `stable/latest.json` there.
- **On the PCs:** installed apps check that file on start and every 3 hours.
  Staff tap to update; the signature is checked; the app reopens.
- **Rule:** the server updates the moment it's deployed, but PCs update when
  staff tap. A new server must keep working with the previous app version.
  Add fields; never rename or remove what an older app still uses.

---

## 5. Data model (45 tables, `src/db/schema.ts`)

| Group | Tables | Notes |
|---|---|---|
| **Booking core** | `appointment`, `slot_hold`, `message_log` | `appointment`: unique index on (dentist, date, time) for live rows; `idempotency_key` unique; `line_user_id` = who booked; `note` (may start with 🚨). `slot_hold`: 10-minute holds, `owner` = LINE account |
| **Dentists** | `dentist`, `dentist_text` (th/en), `dentist_treat` (treatment + kids/adults), `dentist_shift` (per weekday), `dentist_leave` | Photos stored on `dentist`, served from `/api/dentist-photo/[slug]/[size]` |
| **Clinic setup** | `treatment` (price, show/hide, length), `clinic_day` (hours), `holiday`, `clinic_info` (phone, LINE, map, address), `clinic_setting` (chairs, booking rules, change counter) | Everything families see comes from these |
| **Operations** | `waitlist_entry` (walk-ins), `staff_notification`, `rate_limit`, `error_event`, `promotion` | |
| **People** | `guardian`, `child`, `line_contact`, `line_message` | Patient records are created by staff (full edition); the website stores only name + phone on the booking |
| **Full edition** | `visit_record`, `invoice`, `invoice_item`, `payment`, `df_rule`, `patient_credit`, `tooth_state`, `tooth_event`, `treatment_plan`, `plan_item`, `medication`, `clinical_doc`, `patient_file`, `recall`, `supplier`, `stock_item`, `stock_move`, `treatment_consumable`, `expense`, `lab_order`, `staff_user`, `audit_log`, `time_clock` | Built, not live yet |

Schema changes: edit `schema.ts`, then `pnpm db:push` (local). On a live
database, push the schema **before** deploying code that needs it.

---

## 6. Where the code is

```
src/
  app/                          Next.js routes (pages + API)
    page.tsx                    home (next-visit slip, services, dentists, clinic card)
    book/                       booking flow page (server-renders availability)
    bookings/                   my bookings
    dentists/, services/, clinic/, notifications/, privacy/   info pages (privacy = PDPA notice)
    display/                    customer-facing counter screen (full edition, /display?c=…)
    staff/                      web staff console (off in production unless STAFF_WEB=1)
    api/staff/route.ts          staff API: one POST, action name → server function (~100 actions)
    api/staff/events/           live updates (SSE)        api/staff/login/   PIN → token
    api/line/webhook/           incoming LINE events      api/cron/reminders/  LINE reminders
    api/queue/                  waiting-room board data   api/health/          uptime check
    api/client-error/           browser crash reports     api/dentist-photo/   dentist photos
  components/
    patient/                    BookingFlow (booking), BookingsPage, NextBookings (home slip),
                                HomePage, ClinicPage, DentistsPage, PrivacyPage, screen/parts (shared UI)
    staff/shell/                top bar, rail, date field, UrgentNote, CallFamilyNotice, login gate
    staff/schedule/             ScheduleDay (grid + drag), SlotPicker (time picker), BookingModal (new),
                                AppointmentDetailModal (details, move, cancel, message)
    staff/settings/             ClinicSettings (hours, rules, info), EditDentistModal, SystemStatus …
    staff/billing, patients, rooms, stock, reports, chat   full edition
    shared/                     icons, mascot, ErrorReporter
  server/                       everything that touches the database ("server-only")
    actions.ts                  every action the screens call, with guard() for staff ones
    queries.ts                  bookings, availability, holds, dentists, settings, waitlist
    changes.ts                  live-update hub (NOTIFY / LISTEN)
    monitor.ts                  error log + LINE alerts          line.ts      LINE push / verify
    staffAuth.ts                PIN, tokens, login limits       billing, clinical, stock, reports,
                                                                chat, users, dataio  full edition
  lib/                          shared logic, no database
    dates.ts                    Bangkok "today/now", date maths (never the browser's clock)
    slots.ts                    30-min grid, coveredTimes, durations
    staffAvailability.ts        staff picker rules (unit-tested)
    bookingRules.ts             window / book-before / cancel-before
    staffStore.tsx              staff app state      staffEvents.ts   live-update client
    useLine.ts                  LIFF sign-in         idempotency.ts   booking keys
    ageGroup.ts, urgent.ts, treatments.ts, billing.ts, promptpay.ts, bahtText.ts …
  db/schema.ts, db/client.ts    the database schema (single source of truth) and connection
  i18n/dict.ts                  Thai + English texts for the patient site (both languages, always)
  instrumentation.ts            server error hook → monitor
apps/
  staff-desktop/                Tauri desktop app (src/api.ts = HTTP version of the actions)
  queue-site/                   static waiting-room board (polls /api/queue)
deploy/                         Dockerfile, docker-compose.yml, Caddyfile, server-setup.sh,
                                backup.sh, env.production.example
scripts/                        seed, tests (e2e, db, concurrency), load test (k6), benchmarks,
                                deploy-vps.sh
.github/workflows/              ci.yml (every push), staff-app-windows.yml (signed desktop build)
docs/                           this guide, design/ notes 01–07, DEPLOYMENT.md, PROJECT.md
```

**Adding a staff action** touches three places that must match exactly: the
function in `src/server/actions.ts` (with `await guard()`), its entry in the
`OPS` map in `src/app/api/staff/route.ts`, and the wrapper in
`apps/staff-desktop/src/api.ts` (same name, same argument order).

---

## 7. Configuration (environment variables)

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres connection (`DATABASE_URL_DIRECT` if the main one is a pooler, for LISTEN) |
| `STAFF_PIN` | the clinic PIN for the staff app (6+ characters) |
| `STAFF_EDITION` | `queue` or `full`: which screens every staff app shows |
| `STAFF_WEB` | `1` turns on the web staff console in production (normally off) |
| `NEXT_PUBLIC_LIFF_ID`, `LINE_LOGIN_CHANNEL_ID` | LIFF app and LINE Login channel (patient sign-in) |
| `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | webhook signature and push messages |
| `ALERT_LINE_USER_ID` | who gets error alerts (send `myid` to the OA to get yours) |
| `CRON_SECRET` | protects the reminders endpoint |
| `SSE_STREAM_SECONDS`, `STAFF_LIVE_UPDATES` | live-update stream length / off switch |
| `BACKUP_REMOTE` | VPS only: where nightly backups are copied (rclone) |
| `VITE_API_URL` (desktop build) | the server address the staff app talks to |

Locally these live in `.env` (never committed). On the VPS:
`/opt/dentakids/.env.production` (template: `deploy/env.production.example`).
GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`, `RELEASES_TOKEN`.

---

## 8. Running, testing, shipping

**Run locally**
```bash
pnpm install
docker compose up -d                 # local Postgres
pnpm db:push && pnpm db:seed         # schema + demo data (local only)
pnpm dev                             # website + backend → http://localhost:3000
pnpm --dir apps/staff-desktop dev    # staff app UI in a browser → :5173
```
With LINE settings empty, patient pages use a dev stand-in account, so you
can click through booking without LINE.

**Tests** (all run on GitHub for every push):

| Command | Proves | Size |
|---|---|---|
| `pnpm test` | unit: billing maths, baht text, PromptPay QR, slots, age rules, staff availability | 24 |
| `pnpm e2e:test` | the whole flow: booking, rules, window, kids/adults, 1-hour treatments, moves, cancels, holds, guards | 66 |
| `pnpm db:test` | database behaviour: slots, holidays, holds, queue, walk-ins | 28 |
| `pnpm concurrency:test` | 30 requests at once: no double booking, no overpayment, safe retries | 15 |
| `pnpm typecheck`, `pnpm lint` | types and lint (website, backend, desktop) | — |
| `pnpm load:test <scenario>`, `pnpm bench:live` | k6 load test, live-update benchmark (by hand) | — |

Tests use the **local** database only; the concurrency and load tests refuse
anything else.

**Shipping**
- **Website + backend:** push to `main` → (after launch) auto-deploy to the
  VPS. Until launch, Vercel deploys the test site. After launch, work on a
  branch → pull request → CI must pass → merge.
- **Database changes:** push the schema to the live database first
  (additive changes only), then the code.
- **Staff app:**
  ```bash
  gh workflow run staff-app-windows.yml -f notes="what changed"
  ```
  PCs offer the update themselves.
- **First server setup:** see [`DEPLOYMENT.md`](DEPLOYMENT.md)
  (`pnpm deploy:vps root@<ip>`).

---

## 9. Rules before changing anything

1. **Correctness lives in the database.** Inside a lock or transaction, read
   only through `tx`, never the shared `db` pool, or it can deadlock under
   load. Take several day locks in sorted order (`lockDays`).
2. **Time is Bangkok time:** `todayISO()`, `nowMinutes()`, `minutesUntil()` in
   `src/lib/dates.ts`. Never `new Date()` for "today" in UI code.
3. **Every rule the website applies, the server applies too.** The browser is
   for convenience; `slotVerdict` and friends decide.
4. **Keep the server compatible with the previous staff app** (PCs update later).
5. **Real data only:** no placeholder or demo content anywhere a family or
   staff member sees it. Empty shows "–".
6. **Queue edition stays simple:** the 3-item rail; full-edition features
   behind `edition === "full"`.
7. **Clinic colours and the soft look are fixed:** fix bugs, don't restyle.
   Patient site: slip + ledger style, not generic card grids.
8. **Texts in both languages** (`src/i18n/dict.ts`).
9. **Never run tests or seeds against the live database.**
10. **Commit messages say why.** `git log` is the history of every feature.

---

## 10. Status and roadmap

| Step | Status | Notes |
|---|---|---|
| No double booking / no double charge (locks + idempotency) | ✅ | [design/01](design/01-no-double-booking.md) |
| CI on every push, money-maths unit tests | ✅ | [design/02](design/02-ci.md) |
| Monitoring: error log, LINE alerts, health check | ✅ | [design/03](design/03-monitoring.md) |
| Live updates instead of 20 s polling | ✅ | [design/04](design/04-live-updates.md): ~0.1 s instead of 10 s; idle traffic 566 MB/h → 2.4 KB/h per screen |
| k6 load test | ✅ | [design/05](design/05-load-test.md): 200 at once on one slot → 1 booking, 0 errors |
| Faster availability, slimmer staff download, window up to a year | ✅ | [design/06](design/06-faster-availability.md): ~30 → ~60 families/s at p95 < 60 ms |
| Signed auto-update, one app for both editions | ✅ | [design/07](design/07-auto-update.md) |
| Booking rules, pain/emergency note, cancel messages, next-visit slip, staff time picker, privacy notice | ✅ | |

**Before launch (owner):**
- VPS
- DNS (`app.dentakids.net` or `www`, held by 2MakeWeb today; domain renews by **24 Jan 2027**)
- LINE settings (LIFF endpoint, webhook, Publish the Login channel)
- real clinic data
- `ALERT_LINE_USER_ID`, UptimeRobot, `rclone config` for off-site backups
- the clinic approves the privacy text
- check the LINE OA plan (the free plan's 300 messages a month won't cover reminders)

**Before launch (code, at VPS time):** point the staff app at the domain,
auto-deploy, protect `main`.

**After launch:** track repeat no-shows, browser tests (Playwright), small
UX polish.

**Before the full edition:** per-person staff sign-in with expiring sessions,
soft-delete for patient records, real migrations instead of `db:push`, photos
stored as files, the clinic's accountant checks receipts and fees, data
import from FD.
