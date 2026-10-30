# Denta Kids: brief for AI assistants

*A short, self-contained summary for another AI (or a new developer) to read
before helping with this codebase. Accurate as of 2026-10-27 (commit 881441e).
The full guide is [`OVERVIEW.md`](OVERVIEW.md); read it before any large change.*

---

## The short version

Denta Kids is a children's dental clinic in Chonburi, Thailand, and this repo
is its own booking system, not yet live.

- **Families** book from the clinic's LINE account. The booking page opens
  inside LINE, and their LINE account is how they sign in. They pick a
  treatment, a dentist (or "any dentist"), a day and a time. Then they can
  see, move or cancel the booking, and LINE sends confirmations and
  reminders.
- **Staff** use a desktop app on the clinic PCs. At launch it shows only
  today's queue, the schedule and settings. A much bigger "full edition"
  (billing, patient files, dental chart, stock, reports, chat) is already
  built but switched off.
- **Everything runs in one Next.js 16 app** backed by PostgreSQL. The desktop
  app reuses the same screens and talks to it over `POST /api/staff`. Saves
  show on every staff screen within about 0.1 s.
- **The top priorities** are no double bookings (database locks, a unique
  index, idempotency keys), Bangkok time everywhere, the server re-checking
  every rule, and keeping the server working with older desktop-app versions.

---

## What this is

**Denta Kids** is a children's dental clinic in Chonburi, Thailand. This repo
is the clinic's own booking system. It replaces phone-and-paper booking and,
over time, the clinic's old desktop program ("FD").

There are four things people use:

1. **Patient website.** Families open it from the clinic's LINE Official
   Account as a LIFF web app. They book a visit, see, move or cancel their
   bookings, and read the clinic's notices. Families are identified by their
   LINE account (ID token verified with LINE). There are no passwords, and a
   phone number never counts as proof of identity.
2. **Staff desktop app** (Tauri 2, Windows/Mac) for the front desk and
   dentists. It has two **editions**, chosen by the server (`STAFF_EDITION`):
   - **queue** (launch edition): 3 screens. วันนี้ (today's queue, check-in,
     walk-ins), ตารางนัด (dentist × time grid, drag to move) and ตั้งค่า
     (settings).
   - **full** (built, switched off): cashier and receipts (PromptPay QR),
     patient files, dental chart, treatment plans, exam-room screens, stock,
     labs, reports, LINE chat, staff accounts, audit log.
3. **LINE messages**, sent automatically: booking confirmation, move and cancel
   notices, a reminder the day before at 18:00 and another the same morning
   at 07:00.
4. **Waiting-room queue board** (`apps/queue-site`, a plain static site that
   polls `/api/queue`). There is also a customer-facing counter screen at
   `/display?c=…` for the full edition.

**Status:** built and tested, **not live yet**. Production will be a VPS
(Docker Compose: app + Postgres, behind Caddy HTTPS). The current Vercel +
Neon deployment is a throwaway test site. The UI is in Thai first, with
English for the patient site.

---

## Architecture in one picture

```
LINE app (LIFF page)      Clinic PCs (Tauri app)      Waiting-room screen
        │                          │                          │
        ▼                          ▼                          ▼
┌────────────────── ONE Next.js 16 app (App Router) ──────────────────┐
│ patient pages  /, /book, /bookings, /dentists, /services, /clinic   │
│ server actions src/server/actions.ts      ← the website calls these │
│ staff API      POST /api/staff {action,args} ← the desktop app      │
│ live updates   GET /api/staff/events (SSE, Postgres LISTEN/NOTIFY)  │
│ LINE           /api/line/webhook, /api/cron/reminders               │
│ public         /api/queue, /api/display, /api/health, /api/client-error │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
                PostgreSQL 16 via Drizzle ORM (48 tables)
```

- **One app, one deploy.** The website, backend and staff API are the same
  Next.js project, sharing TypeScript types end to end.
- **The desktop app is a thin shell.** It reuses the *same React screens*
  (`src/components/staff/**`), built with Vite. `apps/staff-desktop/src/api.ts`
  replaces server actions with HTTP calls to `POST /api/staff`.
- **Staff sign-in** is a clinic PIN, exchanged for a bearer token at
  `/api/staff/login` (rate-limited). Every staff action calls `await guard()`.

## Stack

Next.js **16.3** (⚠ newer than most training data; read
`node_modules/next/dist/docs/` before using an API) · React 19 with the React
Compiler · TypeScript · PostgreSQL 16 + Drizzle ORM (`postgres` driver) ·
LINE LIFF + Messaging API · Tauri 2 (Rust; it also reads Thai ID cards over
PC/SC) · pnpm · GitHub Actions (CI and the signed desktop build) · k6 for
load tests.

---

## Core domain rules

- **Time grid:** the day is split into 30-minute slots. A treatment has a
  length (`durationMin`) and blocks every half-hour it covers (`coveredTimes`
  in `src/lib/slots.ts`, shared by the website, server and staff app).
- **Bookable time** means: inside the dentist's shift, inside clinic opening
  hours, not on a holiday or the dentist's leave, and free for the whole
  treatment. Dentists are tagged with the treatments they do, for kids,
  adults or both.
- **"Any dentist" (pool) bookings** have `dentist_id = NULL`. They take a
  *chair*, not a dentist, and are admitted while bookings stay under the chair
  count. `settlePool` or staff assign a dentist later.
- **Holds:** tapping a time on the website holds it for 10 minutes. This needs
  a verified LINE account, and each account can hold one time at once.
- **Booking rules** are set by the clinic in `clinic_setting` and enforced on
  the server (`src/lib/bookingRules.ts`):
  - booking window: 1 week to 1 year ahead
  - book-before: hours of notice needed
  - cancel-before: when online changes stop
  - Staff can always override these.
- **The booking path** is `bookAppointment` in `src/server/actions.ts`:
  1. idempotency key check
  2. rate limit and validation
  3. LINE token check
  4. `slotVerdict`, which applies all the rules
  5. `createAppointment`, inside a transaction holding a **per-day Postgres
     advisory lock**, with a **partial unique index** on (dentist, date, time)
     as the last line of defence
  6. LINE confirmation, plus `notifyChange()` to update staff screens live
- **History** (from launch day onward, best-effort writes, nothing reads it
  yet):
  - `visit_event`: every change to a booking or walk-in, with who made it and
    the state before and after
  - `booking_attempt`: every time a family picks a time on the website and
    what happened to it
  - Both live in `src/server/history.ts`.

## Live updates

A save calls `notifyChange()` (`src/server/changes.ts`). That bumps
`clinic_setting.change_seq` and runs `NOTIFY dk_changes`. Each server
instance keeps one `LISTEN` connection and pushes the change over SSE to open
staff screens, which then re-download (`src/lib/staffEvents.ts`). A watchdog
plus a 20-second polling fallback cover dropped streams. Staff client state
lives in `src/lib/staffStore.tsx`: every save goes through `mutate()`, which
calls the server and then re-downloads.

---

## Where to look

| Need | File |
|---|---|
| Database schema (single source of truth) | `src/db/schema.ts` |
| Every action screens call (patient + staff) | `src/server/actions.ts` |
| Booking, availability, holds, dentists, settings | `src/server/queries.ts` |
| Staff API action map (~100 actions) | `src/app/api/staff/route.ts` (`OPS`) |
| Desktop HTTP wrappers | `apps/staff-desktop/src/api.ts` |
| Booking flow UI | `src/components/patient/BookingFlow.tsx`, `src/app/book/page.tsx` |
| Staff time picker rules | `src/components/staff/schedule/SlotPicker.tsx`, `src/lib/staffAvailability.ts` |
| Bangkok dates and times | `src/lib/dates.ts` |
| LINE push / verify / reminders | `src/server/line.ts`, `src/app/api/cron/reminders/` |
| Error log + LINE alerts | `src/server/monitor.ts`, `src/instrumentation.ts` |
| Thai/English texts (patient site) | `src/i18n/dict.ts` |
| Full-edition server code | `src/server/{billing,clinical,stock,reports,chat,users,dataio}.ts` |
| Deploy (VPS) | `deploy/`, `scripts/deploy-vps.sh`, `docs/DEPLOYMENT.md` |
| Design decisions with measurements | `docs/design/01–07` |

**Adding a staff action** touches three places, and they must match exactly
(same name, same argument order):

1. the function in `actions.ts`, starting with `await guard()`
2. its entry in `OPS` in `api/staff/route.ts`
3. its wrapper in `apps/staff-desktop/src/api.ts`

---

## Commands

```bash
docker compose up -d && pnpm db:push && pnpm db:seed   # local DB + demo data
pnpm dev                                 # http://localhost:3000 (dev LINE stand-in if LINE env empty)
pnpm --dir apps/staff-desktop dev        # staff UI in a browser on :5173
pnpm typecheck && pnpm lint && pnpm test # types, lint, 24 unit tests
pnpm e2e:test        # 76 end-to-end booking checks (local DB)
pnpm db:test         # 28 database behaviour checks
pnpm concurrency:test  # 30 parallel requests: no double booking/charge
```

All of these run in CI on every push. Tests refuse anything but the local
database.

---

## Hard rules: don't break these

1. **Correctness lives in the database.** Inside a lock or transaction, read
   only through `tx`, never the shared `db` pool, or it can deadlock under
   load. Take several day locks in sorted order (`lockDays`).
2. **All time is Bangkok time.** Use `todayISO()`, `nowMinutes()` and
   `minutesUntil()` from `src/lib/dates.ts`, never `new Date()` for "today".
3. **The server re-checks every rule.** Browser-side checks are only a
   convenience.
4. **Keep the server backward-compatible with the previous desktop app.** PCs
   update only when staff tap "update". Add fields; never rename or remove
   what an older app still uses.
5. **Schema changes are additive.** Push the schema to the live DB *before*
   deploying code that needs it (`db:push` for now, no migrations yet).
6. **No placeholder or demo content** anywhere families or staff see it. Empty
   values show "–".
7. **The queue edition stays at 3 rail items.** Full-edition features go
   behind `edition === "full"`.
8. **Don't restyle.** Clinic colours and the soft look are fixed; the patient
   site uses a slip + ledger style, not generic card grids.
9. **Patient-site text needs both Thai and English** (`src/i18n/dict.ts`).
10. **Never run tests, seeds or scripts against the live database.**
11. **Commit messages explain *why*.** `git log` is the feature history.

## What's next

- **Launch (owner tasks):**
  - VPS and DNS (`dentakids.net`)
  - LINE channel setup and real clinic data
  - alerts, uptime monitoring, off-site backups
  - privacy-text approval and the LINE OA message plan
  - run `deploy/clear-test-data.sh` once, right before announcing
- **After launch:** repeat no-show tracking, Playwright browser tests.
- **Before the full edition goes live:**
  - per-person staff sign-in with expiring sessions
  - soft-delete for patient records
  - real migrations
  - photos stored as files
  - accountant review of receipts and fees
  - data import from FD
