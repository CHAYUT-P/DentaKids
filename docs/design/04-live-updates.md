# 04 · Live updates instead of 20-second polling

*Status: done (2026-10-23). Code: `src/server/changes.ts`,
`src/app/api/staff/events/route.ts`, `src/lib/staffEvents.ts`, the effect in
`src/lib/staffStore.tsx`. Benchmark: `scripts/liveUpdatesBench.ts`
(`pnpm bench:live`), output in `results/2026-10-23-live-updates.txt`.*

## The problem

Every staff screen used to ask the server for **all** of its data every 20
seconds, whether or not anything had changed. Two things were wrong with that:

1. **Slow to show changes.** A family books on LINE, and the front desk sees
   it 10 seconds later on average and up to 20 seconds later. When two people
   work the same schedule, one of them is looking at an old picture.
2. **Wasteful.** Almost every poll returns exactly what the screen already
   has. With a year of bookings in the database, one download is
   **3.2 MB** (154 KB compressed), 180 times an hour, per open screen.

## What we built

```
 save (staff app, website, LINE webhook)
   │  revalidateStaff() → notifyChange()
   ▼
 Postgres: change_seq += 1 ; NOTIFY dk_changes '<seq>'
   │
   ▼  one LISTEN connection per server instance (src/server/changes.ts)
 GET /api/staff/events   (Server-Sent Events, one per open screen)
   │  event: hello  <seq>    on every connect
   │  event: change <seq>    on every save
   │  : ping                 every 20 s
   ▼
 staff screen: seq > what I have? → download once (150 ms debounce)
```

- **A change counter, not the data.** The stream only says "something changed
  (number 1043)". The screen then downloads the same data it always did. That
  keeps the stream simple and makes it impossible for a screen to end up with
  half an update.
- **Nothing can be missed.** Every connect starts with `hello <current number>`.
  If a save happened while a screen was reconnecting, the number is higher
  than the one the screen has, and it refreshes.
- **Every save path announces itself.** `revalidateStaff()` (which every
  staff-visible save already called) now also calls `notifyChange()`, so
  bookings from the website, staff saves and incoming LINE messages all reach
  the screens. `notifyChange()` never throws: if it fails, the save still
  succeeds and screens catch up at the next connect.
- **Falls back to polling by itself.** If the stream can't connect (network,
  proxy, server can't LISTEN), the screen goes back to polling every 20 s and
  keeps retrying the stream (2 s, 4 s, … up to 30 s). When the stream is back,
  polling stops.

## Measured

A production build (`next start`) against a test database holding **one year
of bookings** (7,834 appointments, about what the clinic does in a year), on
one Mac:

| | Polling every 20 s (before) | Live updates (after) |
|---|---|---|
| Time until another screen sees a save | **10 s** average, 20 s worst | **18 ms** median, 25 ms p95 to hear about it (20 saves); about **0.1 s** until it's on screen |
| Requests per screen per hour, nothing changing | 180 | **72** (a 55-second stream reconnecting) |
| Data per screen per hour, nothing changing | 566 MB (27 MB compressed) | **2.4 KB** |
| Cost of one change | — | one download per open screen (3.2 MB, 154 KB compressed) |

The local times have no internet in them. Over the internet, add the round
trip to the server (tens of ms in Thailand to Vercel's Singapore region), so a
change still shows up in well under a second.

## Decisions and trade-offs

- **SSE, not WebSockets.** The server only ever talks one way ("something
  changed"); saves already go through normal requests. SSE is plain HTTP, works
  through Caddy and Vercel without extra setup, and needs no library. The
  screen uses `fetch` to read the stream rather than `EventSource`, because
  `EventSource` can't send the desktop app's `Authorization` header.
- **Postgres LISTEN/NOTIFY, not Redis.** The database is already there and
  already sees every save. A message bus would be one more thing to run for a
  single clinic. NOTIFY is sent inside Postgres, so several server instances
  (Vercel can run more than one) all hear every change.
- **LISTEN needs a direct connection.** Neon's pooled address (`-pooler.`)
  runs PgBouncer in transaction mode, which can't hold a LISTEN. `changes.ts`
  uses `DATABASE_URL_DIRECT` if set, otherwise the same address without
  `-pooler.`. That's one extra connection per server instance.
- **Streams end after 55 s on Vercel.** Serverless functions have a time limit
  (`maxDuration = 60`), so the server ends each stream at `SSE_STREAM_SECONDS`
  (default 55) and the screen reconnects within 0.3 s. On the VPS there's no
  limit, so `deploy/env.production.example` sets it to an hour.
- **Vercel cost to watch.** An open stream keeps a function running. Fluid
  compute lets many streams share one instance and charges CPU only while code
  runs, but the instance's memory time still counts. With 2–3 screens open
  during clinic hours this should stay in the free allowance; check *Usage*
  after the first week. If it doesn't, set `STAFF_LIVE_UPDATES=off` in Vercel:
  every screen goes back to 20-second polling with no new build (tested).
- **Neon sleeping.** Polling every 20 s already kept the database awake while
  a screen was open, and an open stream does the same, so nothing changes.
  Close the staff app at night and the database can sleep either way.
- **Compression is skipped for the stream** (`deploy/Caddyfile`), because a
  compressor holds back small messages until its buffer fills, which would
  delay every "change" event.

## Not done yet (next step if the data grows)

**Each download still contains every appointment ever** (99% of the 3.2 MB).
Live updates made it happen only when something changed, instead of 180 times
an hour. The next improvement is to send only the dates the screens show
(for example, the last week and everything ahead) and load older history on
request. That's worth doing before the database holds several years.

## Verified

| Test | Result |
|---|---|
| `pnpm bench:live` against the production build | numbers above |
| Staff app open, booking checked in from another client (curl) | screen moved it to มาแล้ว without a reload; one download in the network log, no polling |
| `STAFF_LIVE_UPDATES=off`, same test | stream answers `unavailable`, screen fell back to polling and showed the change within 20 s |
| typecheck, lint, unit, e2e, db and concurrency tests | all pass |
