# 03 · Monitoring: know before the clinic calls

*Status: done (2026-10-23). Code: `src/server/monitor.ts`, `src/instrumentation.ts`,
`src/app/api/health`, `src/app/api/client-error`, `src/lib/clientErrors.ts`,
staff card `src/components/staff/settings/SystemStatus.tsx`.*

## The problem

Before this, if the booking page crashed for some families, or the database
went down at 7 a.m., the first person to know would be a receptionist calling
the developer, or worse, a family who gave up and booked elsewhere. Server
logs existed, but nobody reads logs until something is already wrong.

Monitoring answers two different questions, so it needs two different tools:

1. **"Is it up?"** (uptime). This must be checked **from outside**, because a
   server that is down can't report that it's down.
2. **"What is going wrong?"** (error tracking). This must be captured **from
   inside**, where the errors happen: server, staff API, and the browsers.

## What we built

| Piece | Where | What it does |
|---|---|---|
| **Error log** | `error_event` table, `src/server/monitor.ts` | Every error is grouped by a **fingerprint** (where + message, with ids, refs and numbers blurred), so a crash that happens 500 times is one row with `count = 500`, not 500 rows. |
| **Server errors** | `src/instrumentation.ts` (`onRequestError`) | Next.js calls this for every error in a page, route handler or server action. |
| **Staff API errors** | `src/app/api/staff/route.ts` | That route catches errors to answer the app nicely, so it reports them itself. |
| **Browser crashes** | `src/lib/clientErrors.ts` → `POST /api/client-error` | Website and staff app (web and desktop): uncaught errors and rejected promises. Each message is sent once per page load, at most 5, and noise like extensions or `Script error.` is skipped. Rate-limited per address. |
| **LINE alerts** | `reportError` → `pushLineAlert` | A **new** kind of error, or one not alerted in the last hour, sends a LINE message to `ALERT_LINE_USER_ID`. At most **10 alerts per hour** in total, so an error storm can't flood a phone or the LINE quota. |
| **Health check** | `GET /api/health` | `200 {"ok":true,"database":"ok","dbMs":…,"version":…}`, or `503` if the database doesn't answer. Nothing private. |
| **Uptime** | **UptimeRobot** (free, external) → `/api/health` every 5 min | Emails (or LINE via its app) when the site or database is down, and again when it's back. |
| **สถานะระบบ card** | Staff app → ตั้งค่า → การแจ้งเตือน & บัญชี | The last 7 days of errors, in Thai, with source, place, count and last seen, so the intern or clinic can see problems without server access. |

## Decisions and trade-offs

- **Our own error log instead of Sentry (for now).** Sentry is the industry
  standard and would add stack-trace grouping, releases and a UI. We chose a
  small in-house version because it adds **no new service and no new
  dependency** to a system an intern will maintain, works the same on Vercel
  and on the VPS, and the alert arrives on **LINE**, which the owner actually
  reads. The trade-off: no source maps, no web UI beyond the staff card.
  Moving to Sentry later only changes `reportError`.
- **Fingerprinting blurs numbers and ids.** `"unknown dentist 12"` and
  `"unknown dentist 15"` are one problem, not two.
- **Reporting never throws.** If the database is what's broken, `reportError`
  falls back to the console, which Vercel and Docker keep. Monitoring must
  never be the thing that breaks a request.
- **Uptime is external on purpose.** A check that runs inside the site (a
  cron job, for example) dies with the site. GitHub's scheduled Actions could
  do it, but on a private repo they eat the free build minutes. UptimeRobot's
  free plan checks every 5 minutes at no cost.

## Verified (local)

| Test | Result |
|---|---|
| `GET /api/health` | `{"ok":true,"database":"ok","dbMs":1}` |
| A deliberately crashing route (temporary, removed after), hit twice | caught by `onRequestError` → **1 row, count 2**, `route GET /api/…` |
| Staff API call that throws (`updateDentist` on an unknown dentist) | recorded as `staff-api · action updateDentist` |
| Same browser crash reported twice | **1 row, count 2** (grouped) |
| สถานะระบบ card | shows all three in Thai with counts and times |

## Setup the owner must do (once, about 5 minutes)

1. **Your LINE id for alerts:** add the clinic's LINE OA as a friend on your
   phone and send **`myid`**. It replies with your user id (`U…`). In Vercel →
   Settings → Environment Variables add `ALERT_LINE_USER_ID` = that id, then
   Redeploy. (On the VPS, put it in `deploy/.env.production`.)
2. **Uptime:** sign up free at uptimerobot.com → *Add New Monitor* → HTTP(s) →
   URL `https://denta-kids-ten.vercel.app/api/health` → every 5 minutes →
   alert contact: your email (or the UptimeRobot app for phone push).
3. Check **ตั้งค่า → การแจ้งเตือน & บัญชี → สถานะระบบ** now and then.
