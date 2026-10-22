# 05 · HTTP load test (k6)

*Status: done (2026-10-23). Script: `scripts/load/booking.js` (k6), runner
`scripts/loadTest.ts` (`pnpm load:test <scenario>`). Full output:
`results/2026-10-23-load-test.txt`.*

## The question

Design note 01 proved the booking rules hold when 30 calls race **inside one
process**. This test asks the next questions, over real HTTP:

1. Do the guarantees still hold when hundreds of families hit the **real
   endpoints** at once?
2. How fast is booking at a realistic peak?
3. Where does one server stop keeping up, and what gives way first?

## How it works

- **The real path, not a test endpoint.** Each simulated family does what the
  phone does: `GET /book` (the page, server-rendered with 14 days of
  availability), then the `holdSlot` and `bookAppointment` **server actions**,
  called over HTTP exactly as React calls them (`POST /book` with a
  `Next-Action` header). The runner reads the action ids from the build, so
  nothing new had to be opened to the internet to make this testable.
- **Every family is its own address** (`X-Forwarded-For`), because the rate
  limit is per address. One scenario tests the limit itself.
- **Afterwards the runner checks Postgres**, not just HTTP answers: no
  dentist booked twice (overlap by duration), no time with more bookings than
  chairs, and the "booked" answers match the rows.
- **Setup:** production build (`next start`, one Node process) on an Apple M3
  Pro, local Postgres 16, a test database holding **one year of bookings**
  (7,834), LINE switched off. k6 1.0 runs in Docker. The runner refuses to run
  against anything but a local database.

## Results: correctness under load

| Scenario | What happens | Result |
|---|---|---|
| `same_slot` | **200 families** book the same dentist at the same time, all at once | **1 booked, 199 told "taken"**, 0 errors. Database: 1 booking |
| `any_slot` | 200 families book "any dentist" for one time, 3 chairs (1 already taken) | **2 booked**: chairs exactly full (3/3), 0 errors |
| `same_ip` | one address books 30 different free times | **20 booked, 10 refused**: the limit is 20 per 10 minutes |
| `journey`, `steady`, `stress` (all runs) | thousands of families picking random times until the clinic is full | **0 double-bookings, never more than 3 per time**, every run |

All 200 requests in the spike are answered in **0.5–0.65 s**, because
bookings for one day take turns (the day lock from design/01). Nobody gets an
error; one family gets the slot and the rest are told to pick another time.

## Results: speed and the limit of one server

`journey` ramps like a real promotion: 5 families/s, then up to 30/s held for a
minute (2,639 families, 5,798 requests):

| Request | median | p95 | p99 |
|---|---|---|---|
| `GET /book` (whole page) | 15 ms | **27 ms** | 45 ms |
| hold a time | 6 ms | **10 ms** | 14 ms |
| confirm booking | 31 ms | **55 ms** | 70 ms |
| failed requests | | **0 of 5,798** | |

Then holding a steady rate for 30 s (`steady`), and an overload ramp to 400/s
(`stress`):

| Families per second | page p95 | booking p95 | errors | kept up? |
|---|---|---|---|---|
| 30 (journey) | 27 ms | 55 ms | 0 | yes |
| 40 | 1.9 s | 9.2 s | 0 | **no**, queueing starts |
| 60 | 2.9 s | 14.1 s | 0 | no (~48/s served) |
| 80 | 5.0 s | 21.4 s | 0 | no (~49/s served) |
| 50 → 400 | 8.2 s | 40.2 s | 0.05% (7 page timeouts) | no (~57/s served) |

**One server process handles about 30–35 families per second** (90–105
requests/s) at well under 0.1 s. *(Fixed afterwards: [design/06](06-faster-availability.md)
batches the availability queries, which doubled this to ~60–70.)* At 40/s both the Node process and Postgres
were at about one full CPU core each (measured with `ps` and `docker stats`).
Node runs JavaScript on a single core, and the `/book` page is the heaviest
request because it works out two weeks of availability on every visit.

**What gives way first is speed, not correctness.** Overloaded 13× past the
limit, the server answered 99.95% of requests, and the database checks passed
every time. Bookings slow down more than pages under overload, because
bookings for one day take turns holding the day lock. When the CPU is busy,
each turn takes longer and the line behind it grows. That's the price of the
guarantee, and it only shows up far beyond real traffic.

## What it means for the clinic

The clinic takes tens of bookings a day. Even if a LINE broadcast reached
2,000 families and **every one** opened the booking page in the same minute,
that's ~33 per second: about the limit of **one** process on one laptop
core. Real behaviour (a fraction of people, spread over an hour) is hundreds
of times below it.

- **Vercel** starts more instances when traffic grows, so the per-process
  limit isn't the ceiling there. The shared database is.
- **VPS:** a small VPS core is slower than an M3, so expect a lower number
  per process. If it's ever needed, run two app containers behind Caddy
  (`reverse_proxy app1 app2`). Postgres would have headroom left on a
  multi-core machine.

## Trade-offs and what's not done

- **Measured locally, not on the deployed site.** The live site runs on real
  clinic data and LINE, and load-testing it would book fake visits and use
  the free database's compute. The honest next step is a staging copy (Vercel
  preview + a Neon branch) and the same script with `BASE=<staging url>`. The
  numbers above exclude the internet round trip.
- **Most later requests are "slot full" answers.** The clinic fills up (520
  bookings, every chair for two weeks) within the first part of each run,
  just like a real rush. That path is cheaper than a successful booking, but
  the `same_slot` and early `steady` traffic covers the expensive one.
- **If the limit ever matters:** cache the `/book` page's availability for a
  few seconds (one calculation shared by everyone opening the page at that
  moment), and serve the same 14 days to the calendar from one query instead
  of one per day. Not worth the complexity at today's traffic.

## Run it

```bash
pnpm build
# terminal 1: production server on a LOCAL test database, LINE off
PORT=3002 DATABASE_URL=<local db> LINE_LOGIN_CHANNEL_ID= LINE_CHANNEL_ACCESS_TOKEN= pnpm start
# terminal 2
DATABASE_URL=<same local db> pnpm load:test same_slot   # or any_slot, same_ip, journey, steady, stress
```
