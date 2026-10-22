# 06 · Faster availability, a slimmer staff download, a booking window up to a year

*Status: done (2026-10-23). Code: `slotsForDates` in `src/server/queries.ts`,
`bookingAvailability` and `staffBootstrap` in `src/server/actions.ts`, the
calendar in `src/components/patient/BookingFlow.tsx`, `mergeFresh` /
`loadHistory` in `src/lib/staffStore.tsx`, `src/lib/bookingWindow.ts`.
Numbers: `results/2026-10-23-load-test-after.txt`.*

## The problems the measurements found

Design notes 04 and 05 measured the system and found two costs that grow with
time:

1. **The booking page asked the database ~100 questions per visit.** It
   worked out availability one day at a time, about 7 queries per day, for 14
   days. At 40 families per second, Postgres and Node were each out of a CPU
   core. A longer booking window would have made it worse: a year is ~2,500
   queries per visit.
2. **Every staff refresh downloaded every appointment ever.** With a year of
   data that's 3.2 MB per download, growing every year.

The clinic also wanted to choose how far ahead families can book, up to a
year. That made problem 1 urgent.

## What changed

- **Availability in one batch.** `slotsForDates(dates)` asks the same 7
  questions whatever the number of days (opening days, holidays, dentists,
  leave, shifts, bookings, holds), then applies the rules in memory. The old
  `slotsForDate(date)` is now a one-day call of it, so every rule has a single
  definition. A test checks the batched answer equals the day-by-day one.
- **The calendar loads months as they're opened.** The page ships the first
  3 weeks. When the family moves to a later month, the calendar asks for that
  month only (`bookingAvailability`, rate-limited). Days still loading can't be
  tapped.
- **Booking window setting** (ตั้งค่า → กฎการจอง & เก้าอี้): 1 week up to 1
  year, default 2 weeks. It's enforced **on the server** for holds, bookings
  and reschedules. Before this change, the 14-day limit lived only in the
  calendar, so a request sent without the page could book any date.
- **Staff download: 30 days back plus everything ahead,** plus any older
  appointment changed in the last day (an old visit edited on another PC still
  reaches every screen). Older history loads **once, when a screen needs it**:
  search, the past-appointments list, a patient's visits, or the schedule
  going further back.
- **Bookable times stay inside the clinic's opening hours** as well as the
  dentist's shift.

## Measured (same machine, same year of data, same k6 scripts as design/05)

| | Before | After |
|---|---|---|
| Queries per booking-page visit | ~100 | ~15 |
| Booking page at 40 families/s, p95 | 1.9 s | **13 ms** |
| Confirm booking at 40 families/s, p95 | 9.2 s | **45 ms** |
| Most families/s one server keeps up with | ~30–35 | **~60–70** (60/s: page p95 10 ms, booking p95 60 ms, 0 errors) |
| Most families/s one server serves at all | ~50–57 | ~100 |
| 200 families on one slot at once | 1 booked, answered in 0.5–0.65 s | 1 booked, answered in **0.2 s** |
| Staff download | 3.2 MB (154 KB compressed), 79 ms | **0.5 MB (34 KB), ~20 ms** |
| One month further ahead (1-year window) | — | 8 ms, 1.2 KB compressed |

The booking guarantees held in every run: no dentist double-booked, never
more bookings at one time than chairs.

## Trade-offs

- **Old appointments changed on another PC more than a day ago** don't reach
  a screen that loaded history earlier, until it's reopened. Old visits rarely
  change, and the window is easy to raise.
- **The "changed lately" check has no index on `updated_at`.** At a clinic's
  size (thousands of rows a year) the scan takes milliseconds. Add the index
  if the table reaches hundreds of thousands of rows (a schema change, so push
  it to the live database first).
- **Availability is still calculated on every visit, not cached.** With ~15
  queries per visit it doesn't need to be yet. A few seconds of caching would
  be the next step for a much bigger rush.
