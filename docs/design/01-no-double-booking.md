# 01 · No double booking, no double charge

*Status: done (2026-10-22). Code: `src/server/queries.ts`, `src/server/billing.ts`,
`src/server/actions.ts`. Test: `pnpm concurrency:test` (`scripts/concurrencyTest.ts`).*

## The problem

A booking system has one job it must never get wrong: **two people must not get
the same thing**. Here, "the same thing" is a dentist's half-hour or a dental
chair. For payments it means that money is recorded once and never more than is
owed.

Most bugs of this kind are invisible in normal use, because they only happen
when two requests arrive within milliseconds of each other. A clinic gets those
from:

- two families tapping "confirm" for the same popular slot
- a parent double-tapping because LINE's in-app browser was slow
- a phone retrying a request after the signal dropped
- two counters (front desk and a room PC) taking payment on the same bill

So we tested it the only way that counts: **fire 30 requests at the same
instant** through the real server code, then count what landed in Postgres.

## What went wrong before (measured)

`docs/design/results/2026-10-22-concurrency-before.txt`, 30 simultaneous requests each:

| Scenario | Correct | Before |
|---|---|---|
| 30 families, same dentist, same time | 1 booking | ✅ 1 |
| 30 "any dentist" bookings, 2 chairs | 2 bookings | ❌ **30** |
| Same booking sent 30× (one tap, retried) | 1 booking, all told "booked" | ❌ 2 rows, 29 told "refused" |
| 30 payments of ฿1,000 on a ฿1,000 bill | ฿1,000 paid | ❌ **฿28,000 paid** |
| One payment double-clicked 30× | recorded once | ❌ **26 rows** |
| Two bills spending one ฿500 deposit | one succeeds | ❌ both, deposit **−฿500** |

The named-dentist case was already safe. A **unique index** on
`(dentist_id, date, time) WHERE status <> 'cancelled'` makes Postgres itself
refuse a second row, which is the strongest guarantee there is. Everything else
followed the pattern **check, then act**: read "is there room?", then insert.
Between the read and the insert, 29 other requests read the same answer.

## The options we weighed

| Option | How it works | Why / why not |
|---|---|---|
| **Check in app code** (what we had) | `SELECT` count, then `INSERT` | ❌ The race above. Correct only with one user at a time. |
| **Unique index / constraint** | The database refuses a duplicate row | ✅ Best when "conflict" means "same key". We keep it for named dentists. ❌ Can't express "at most 2 rows" (chairs) or "ranges overlap" (1-hour treatments). |
| **Exclusion constraint** (`btree_gist`, `tsrange && `) | The database refuses overlapping time ranges | Elegant for overlap. ❌ Doesn't handle chair *capacity*. Needs an extension, and Drizzle's schema tool can't manage it. |
| **`SELECT … FOR UPDATE` row locks** | Lock the rows you read | ❌ There's no row to lock for an *empty* slot (phantom problem). |
| **`SERIALIZABLE` isolation + retry** | Postgres aborts one of two conflicting transactions | Correct, but every caller needs retry loops, and failures surface as errors under load. More moving parts than we need. |
| **Advisory lock per clinic day** ✅ | `pg_advisory_xact_lock(hash('appt-day:' + date))`, then check, then insert, in one transaction | ✅ Simple, correct for capacity *and* overlap. The lock is released automatically at commit or rollback. Contention is bounded: only bookings on the **same day** wait for each other, for a few milliseconds. |

**We chose the day lock, plus the existing unique index as a second wall.**
Payments use the same idea: a lock per bill (`pay:<id>`), plus a lock per
patient's deposit (`credit:<childId>`), because two bills can draw on one
deposit.

### Why "per day" and not finer or coarser
- **Per dentist** is too fine. "Any dentist" bookings compete for *chairs*
  across all dentists.
- **One global lock** is too coarse. Bookings for different days don't
  interact, so they shouldn't wait for each other.
- **Per day** matches the real boundary: everything that can conflict, chair
  count and overlapping times, is within one clinic day.

## Idempotency keys

Locks stop *different* requests from both winning. They don't help when the
**same** request arrives twice: a double tap, or a retry after a timeout where
the first attempt actually succeeded. For that, the client makes a random key
**once per attempt** (`src/lib/idempotency.ts`) and sends it with the request:

- **Website booking:** one key per booking flow (`BookingFlow.tsx`)
- **Staff "new appointment":** one key per window (`BookingModal.tsx`)
- **Cashier payment:** one key per payment (`CashierView.tsx`; the bill panel
  is rebuilt after each payment, which makes the next key)

The server stores the key on the row (`appointment.idempotency_key`,
`payment.idempotency_key`, both **unique**). A request whose key already exists
gets the **original result back**: same booking code, same receipt. It doesn't
send a second LINE confirmation or write a second audit-log line. The key is
checked twice: once up front (the fast path for a later retry), and again
**inside the lock** (for two copies arriving at the same instant). The unique
index is the final backstop.

## The bug the test found in our first fix

The first version of the fix **hung** under the 30-request test. This is a
classic **connection-pool deadlock**:

1. The pool has 10 database connections.
2. 30 requests each open a transaction (taking a connection) and wait for the day lock.
3. The request holding the lock then calls `getChairs()` on the **shared pool**
   for a second connection, but all 10 are held by waiters.
4. Nobody can move.

**Rule we adopted:** code that holds a lock reads **only through its own
transaction**. `getChairs`, `getBill`, `billsWhere`, `coverageUsage` and
`creditBalance` now take an optional query runner (`q`), and callers inside a
lock pass `tx`. No normal test would ever have shown this. Only real
concurrency does.

## Trade-offs and limits (honest)

- **Same-day bookings are serialized.** Each one waits a few milliseconds for
  the previous one. At clinic scale (dozens per day) that's invisible. At
  hotel-chain scale you'd shard the lock finer, for example per (day, chair
  group), or move to an inventory table with row locks.
- **Holds ("we keep this time for 10 minutes") are not locked.** Two families
  can both see a hold succeed for the last chair. The guarantee is enforced at
  **confirm** time, where the loser gets "this time was just taken". That's the
  usual design: holds are a courtesy, and the booking is the contract.
- **Staff drag-and-drop moves** use a pre-check, not the day lock: one operator
  at a desk, low risk. Patient postponing does use the lock
  (`moveAppointmentGuarded`).
- **Keys live forever** on the rows they created. That's fine at this volume. A
  high-traffic system would expire them, for example after 24 hours, in a
  separate table.

## Results (after)

`docs/design/results/2026-10-22-concurrency-after.txt`: **15 / 15 checks
pass**, with each burst of 30 simultaneous requests finishing in about
60–120 ms on a laptop:

| Scenario | Result |
|---|---|
| 30 families, same dentist and time | exactly **1** booking |
| 30 "any dentist", 2 chairs | exactly **2** bookings, never more than 2 in the chairs |
| 1-hour vs 30-min bookings racing to overlap | **0** overlapping half-hours |
| Same booking ×30 (one key) | all 30 told "booked", **1** row, same code, later retry gets it too |
| 30 payments on one bill | **1** goes through, bill paid exactly ฿1,000 |
| One payment ×30 (one key) | all OK, recorded **once** |
| Two bills, one ฿500 deposit | **1** succeeds, deposit ends at ฿0, never negative |

Run it yourself (local database only; it refuses to run against any other):

```bash
docker compose up -d && pnpm db:push && pnpm db:seed
pnpm concurrency:test          # N=100 pnpm concurrency:test for a bigger burst
```

## How to explain this in an interview (short version)

> "Bookings and payments were *check-then-act*, so concurrent requests could
> all pass the check. I measured it: 30 simultaneous 'any dentist' bookings
> filled 2 chairs 30 times, and one bill was paid 28×. I fixed it with a
> Postgres advisory lock scoped to the clinic day, so the capacity check and the
> insert are atomic, and kept the unique index as a second guard. For retries
> and double taps I added client-generated idempotency keys stored under a
> unique constraint. The load test also exposed a connection-pool deadlock in my
> first fix, from reading through the pool while holding the lock, which taught
> me to keep every read inside the lock on the transaction's own connection.
> After: 15/15 concurrency checks pass at 30× simultaneous requests."
