# Denta Kids — Project Understanding

Pediatric dental clinic. Four products, one shared backend.

| # | Product | Users | Stack |
|---|---------|-------|-------|
| 1 | **Patient web** — LINE LIFF booking app | Parents/guardians of child patients | Next.js (App Router), mobile-first, opened inside LINE |
| 2 | **Staff app** — desktop management tool | Clinic staff (front desk, admin) | **Tauri 2 shell** over the hosted `/staff` console (`apps/staff-desktop`) |
| 3 | **Queue-check web** — minimal status page | Parents waiting at the clinic | Static site (`apps/queue-site/`), calls `/api/queue`; hosted separately |
| 4 | **Backend** | all apps | Next.js route handlers + managed Postgres |

The clinic already runs a separate application for patient management; it stays in charge for now.
Product 2 starts as *appointments + website content* only, and may absorb the old system later.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Staff app platform | **Tauri 2** (WebView wrapper, Windows + macOS) — supersedes the earlier WinUI 3 plan: the web console already exists and works, a native rewrite bought nothing for a scheduling tool |
| Backend shape | Next.js API routes + managed Postgres (one deploy serves LIFF pages *and* the API the desktop app calls) |
| LINE | OA + Messaging API + LIFF channels exist, but credentials are held by the owner's aunt and not available yet → **build against a mock, wire the real thing later behind one interface** |
| Booking flow | Treatment → dentist → date/time, **auto-confirmed** (no staff approval step) |
| Home screen | Reference style 1, **solid colour (no gradients)** — the base look for the whole patient web. The tooth mascot is the one exception: it keeps its soft shading. |
| Languages | Thai **and** English, Thai default, switch top-left, choice stored in `localStorage` under `dk:lang` |

---

## 1. Patient web (LIFF)

Design goal: a parent holding a phone with one hand and a child with the other must finish a booking without thinking. Few taps, big targets, no jargon.

- **Login**: LINE (LIFF). We get the LINE `userId`, display name and picture — that is the account. No password, no separate signup.
- **Book**: choose treatment → choose dentist → choose date & time → confirm. Slot is reserved immediately.
- **My appointments**: upcoming + history, with the booking reference. Cancel/reschedule rules TBD.
- **Booking identity (changed 2026-10-01)**: a booking collects only a **nickname + phone** — the name the family says at the desk. No guardian/child details. Inside LINE the booking is also stamped with the LINE account (`appointment.line_user_id` + `line_name`): that is what lists "my bookings" in LINE, where reminders go, and what staff see as "LINE · <name>". Patient-site bookings create no guardian/child rows; patient records are the full edition's job.
- **Dentists**: profile pages — photo, name, specialty, description. Content comes from the staff app.
- **Treatments & prices**: list with icons and prices, maintained in the staff app.
- **Promotions / announcements**: content slots inside the booking web, so the clinic can advertise there.
- **Clinic info**: hours, phone, map/directions.
- **LINE messages**: booking confirmation, reminder before the appointment day, reminder on the day.

### Routes built (2026-09-01)

Every screen below renders from `src/data/*.ts` mock data and `src/i18n/dict.ts`
copy. Nothing talks to a database or to LINE yet; the shapes are what the API
will have to return.

| Route | What it is | Rendering |
|---|---|---|
| `/` | Home — the reference sheet: mascot, treatment tiles, dentist strip, clinic ribbon | static |
| `/book` | The whole booking flow, four steps in one client component | dynamic (`connection()` — needs the clinic's clock) |
| `/bookings` | Upcoming appointment as a slip, history as ledger rows with *book again* | dynamic |
| `/dentists` | All five dentists, each row tapping through to the detail page | static |
| `/dentists/[slug]` | The big profile: large portrait, description, credentials, treatments, days | SSG over the five slugs |
| `/services` | Treatments and prices by group | static |
| `/clinic` | About, hours (today highlighted), phone + LINE, map card with a Google Maps link, facilities, payment | dynamic (highlights today) |
| `/notifications` | The in-app copy of what the clinic sends over LINE | dynamic |
| `/icons` | Internal icon reference, `noindex` — not a patient page | static |

**Booking flow shape** (`src/components/BookingFlow.tsx`): treatment → dentist →
day + time → confirmed, as a `step` in state rather than four routes, so a
half-finished booking is not a back-button trap. Step 2 offers *any dentist* plus
only the dentists who take that treatment (`dentistsFor()`); general treatments —
check-up, consult, follow-up — are offered by everyone. Confirming needs no
approval, so step 4 is the slip itself with its reference code.

**The clock is the server's, always.** `todayISO()` and `nowMinutes()` (both
pinned to `Asia/Bangkok` in `src/lib/dates.ts`) run on the server and arrive as
`today` / `nowMin` props; no component reads `Date` in the browser. That is what
keeps the server render and the hydrated render identical, and it is why the
date-bearing routes above are dynamic. Slot fullness and booking references come
from a deterministic hash of the booking, for the same reason — the same slot is
full on the server and on the phone, and a reload does not mint a new reference.
Mock appointments are stored as an offset in days from today, so they never rot;
`openDay()` nudges one off a Sunday, since the clinic is closed then.

## 2. Staff app (Tauri desktop)

- **Appointments**: schedule view (day/week, by dentist), create phone-in bookings, edit, cancel, mark done/no-show.
- **Dentists**: add/edit/remove — name (TH/EN), photo, specialty, description, working days/shifts. *Profile and description are published to the patient web.*
- **Treatments**: add/edit/remove — name, description, duration, price, icon.
- **Website content**: promotions/banners, clinic information, price changes — everything the patient web shows.
- **Patients (lighter scope)**: guardian + child records, contact, notes. Not a medical record system.
- **Settings**: opening hours, holidays, slot rules, staff accounts and roles.
- **Out of scope for the queue edition**: billing, clinical charting, X-ray/imaging, stock. The full edition is growing into the whole clinic system (billing is in; charting, stock and reports follow), replacing the clinic's current program (FD by 9net) one part at a time.

### Editions — one app, the server decides

| | **Queue** (first install) | **Full** |
| --- | --- | --- |
| Scope | queue, bookings, dentist + treatment + clinic content | everything in Queue, plus patient records, per-dentist room pages and การเงิน (bills, receipts, DF, day close) |
| Server | `STAFF_EDITION=queue` (default) | `STAFF_EDITION=full` |

- **One desktop app** (`pnpm --dir apps/staff-desktop build:app`) carries both
  editions' screens. The server sends `edition` in the staff bootstrap (from
  `STAFF_EDITION`), so moving the clinic to the full edition is one line on
  the VPS and a restart: no reinstall, every PC follows on its next refresh.
  The web console reads the same variable. Components check `edition` from
  `useStaff()`. `src/edition.ts` is only the fallback for an older server
  (`vite --mode full` makes a local preview default to full).
- **Room mode** is a per-device localStorage switch (Settings → หน้าจอเครื่องนี้,
  full only): a treatment-room PC locks onto one dentist's page
  (`/staff/rooms/[slug]` web, `#/rooms/:slug` desktop) — its waiting line plus
  the visit-record form. The gear floating button exits back to the desk.
- Visit records (`visit_record` table) attach to an appointment OR a walk-in,
  one per visit: the treatments done as priced lines (`items`: treatment,
  teeth, qty, price), a detail note, and the total. "เสร็จสิ้น & บันทึก"
  saves the record and frees the chair in one action.
- **การเงิน** (`CashierView`, `/staff/cashier` · `#/cashier`, server code in
  `src/server/billing.ts`, shared maths in `src/lib/billing.ts`):
  - A bill (`invoice` + `invoice_item`) is opened from a visit and pre-filled
    from the room's lines; the cashier can edit lines, add products, set line
    or bill discounts and lab costs. Bills for no visit (product sales) too.
  - Payments (`payment`) can be split across methods (cash with change,
    PromptPay QR with the amount, transfer, card). The first payment gives the
    receipt number `<prefix><พ.ศ. yy><mm>-<0001>`; a settled bill is locked —
    cancel it with a reason (kept for the day close) and bill again.
  - DF (`df_rule`): most specific rule wins — dentist + treatment →
    treatment → dentist → clinic default; % of the line after its share of
    the bill discount and its lab cost, or baht per unit. Frozen on the line.
  - Day close: money in by method, bills owing, DF per dentist for settled
    bills, cancelled bills with reasons; printable, like the receipt (A5 or
    80 mm slip, Settings → การเงิน & DF).
- All screens poll `staffBootstrap` every 20s — a check-in at the desk shows
  up on the room PC without a reload.

### Full edition modules (built 2026-10-02)

The full edition is the whole clinic system (replacing FD by 9net), in
these rail entries — all gated on `edition === "full"` and on the signed-in
role (`src/lib/roles.ts`):

| Entry | Holds | Server |
|---|---|---|
| คนไข้ | patient list, ถึงรอบตรวจ (recalls + LINE reminder); every row opens the **patient file** | `server/clinical.ts` |
| ห้องตรวจ | a dentist's room: queue, visit lines (treatment · teeth · qty · price), patient file button | `queries.ts` (visit_record) |
| การเงิน | รับชำระ (bills, split payments, PromptPay QR, deposits, receipts), ปิดยอด, ค่าใช้จ่าย | `server/billing.ts`, `server/stock.ts` |
| คลัง & แลป | stock + movements, what each treatment uses, lab orders, suppliers & labs | `server/stock.ts` |
| รายงาน | money, treatments, dentists + printable DF statement, appointments, receivables, voids | `server/reports.ts` |
| ตั้งค่า | + การเงิน & DF, ผู้ใช้ & สิทธิ์ (accounts, roles, activity log), นำเข้า / ส่งออกข้อมูล (CSV) | `server/users.ts`, `server/dataio.ts` |

- **Patient file** (`PatientFileView`, opened via `PatientFileButton` from
  patients, room, cashier and the booking dialog — it makes a file from name
  + phone if none exists): overview & alerts, FDI dental chart for baby and
  permanent teeth with history (`tooth_state`/`tooth_event`), treatment
  plans/estimates and instalment contracts (`treatment_plan`/`plan_item`;
  bills carry `plan_id`), visit and bill history, paperwork
  (`clinical_doc`: prescription, certificate, referral, consent — printable;
  `medication` drug list), photos/X-rays (`patient_file`, base64, photos
  shrunk client-side, ≤3 MB), deposits (`patient_credit`, spent with the
  "credit" payment method, deposit receipts are `invoice.kind = 'deposit'`).
- **Stock** moves on a bill becoming paid (sold products via
  `invoice_item.stock_item_id`, treatment consumables via
  `treatment_consumable`), reversed on void; once per bill.
- **Accounts**: the clinic PIN still unlocks the device; each person then
  signs in with their own PIN (`staff_user`), carried as a signed token
  (header `X-Staff-User` on desktop, cookie `dk_user` on web). Full-edition
  actions call `guard(perm)`; important ones write `audit_log`. No accounts =
  open mode (everyone is owner).
- FD parity extras: **จอลูกค้า** (`/display?c=<code>`, polls `/api/display`;
  the cashier's switch pushes the open bill), on-screen **signatures**
  (`SignaturePad`; plans store `signature`/`signed_by`/`signed_at`, consent
  forms keep it in `clinical_doc.data`), **camera** capture into patient
  files, **after-visit LINE** care advice / thanks + review link once per
  paid bill (`invoice.care_sent_at`; advice per treatment in clinic_setting
  `aftercare`), **ลงเวลาทำงาน** (`time_clock`, punch with own PIN; monthly
  hours in ผู้ใช้ & สิทธิ์).
- More FD parity: **สิทธิการรักษา** (`child.coverage`; payment methods
  `sso`/`nhso`/`insurance` are claims with `payment.claim_status`, kept out
  of cash totals; การเงิน › เบิกสิทธิ์ lists and exports them), **Thai ID
  card reader** (desktop only: `src-tauri/src/idcard.rs` over PC/SC, called
  through `src/lib/idCard.ts`), **แชท LINE** (`line_contact`/`line_message`;
  the webhook saves incoming, `pushLineText` records outgoing; unread count
  rides the bootstrap as `lineUnread`), **PDPA** consent document.
- Ease of use: วันนี้ shows each arrived visit's stage (รอตรวจ → กำลังตรวจ →
  ตรวจเสร็จ·รอชำระ → ชำระแล้ว) with รับชำระ jumping to that bill
  (`goStaff('/cashier?visit=a-<id>')`, read back with `staffQuery`); the rail
  separates daily work from the back office; ตั้งค่า opens on a
  เริ่มต้นใช้งาน checklist with grouped sections — all full edition only.
- The dental chart draws real teeth — side view + five-surface top view —
  with shape data from DentalPin (`src/lib/toothShapes.ts`, BSL 1.1 notice
  kept; production use allowed except as a commercial clinic-management SaaS).
- Every new table is additive; **run `pnpm db:push` on production before
  deploying** — the shared bootstrap reads `visit_record.items`.

### Navigation (redesigned 2026-09-30)

Three rail entries instead of eight (full edition adds คนไข้, ห้องตรวจ and การเงิน);
entries come from `railItems()` in `src/components/staff/staffRail.tsx`, shared
by the web sidebar and the desktop one.

| Entry | Route (web / desktop) | What it holds |
|---|---|---|
| วันนี้ | `/staff` · `#/` | the queue board (`app/staff/queue/page.tsx`): ยังไม่มา → รอเรียก → บนเก้าอี้, walk-ins merged in |
| ตารางนัด | `/staff/schedule` · `#/schedule` | `ScheduleView`: วัน = per-dentist calendar (`ScheduleDay`), รายการ = the booking directory (`app/staff/appointments/page.tsx`) |
| ตั้งค่า | `/staff/settings` · `#/settings` | `SetupView`: roster, prices, and each `ClinicSettings` group as a sub-menu item |

The top bar (`StaffTopbar`) is the only place for search, + Walk-in, + นัดใหม่
and the bell (notifications moved there from their own page). Old addresses
redirect to the entry that absorbed them. Look: clinic palette in `staff.css`
tokens, plum ink for primary buttons; the desktop app bundles Prompt + Mitr via
`@fontsource` because its CSP blocks Google Fonts.

## 3. Backend

- One Next.js project: LIFF pages + `/api` route handlers. The desktop app is just another HTTP client.
- Postgres (managed). Timezone `Asia/Bangkok`.
- **Two separate auth paths**: patients present a LINE ID token (verified server-side); staff use clinic credentials issued for the desktop app.
- **Scheduler** for reminder pushes (cron-style job hitting the LINE Messaging API).
- Anything the patient web renders as "content" is staff-editable data, not hardcoded copy.

### Data model sketch

    guardian        line_user_id, display_name, phone
    child           guardian_id, name/nickname, birthdate, notes      -- the actual patient
    dentist         slug, photo_small, photo_large, years, tint, is_active, sort
    dentist_text    dentist_id, lang, name, title, blurb, bio,
                    credentials[], languages, days
    dentist_treat   dentist_id, treatment_id                            -- who takes what
    dentist_shift   dentist_id, weekday, start, end
    treatment       name, description, duration_min, price, icon, is_active, sort
    appointment     child_id, dentist_id, treatment_id, starts_at, ends_at, status, source, ref_code, note
    holiday         date, reason
    promotion       title, body, image, starts_at, ends_at, is_active
    clinic_setting  open/close time, lunch, slot granularity, open days
    staff_user      username, password_hash, role
    message_log     appointment_id, kind, sent_at, line_response

**Two pictures per dentist, not one** (`src/data/dentists.ts`): `photo.small` is
the round thumbnail for lists and the booking flow, `photo.large` the portrait on
the detail page. Both are empty strings today and `src/components/portrait.tsx`
draws a flat SVG face from a `Face` spec instead; it switches to the real image
the moment the staff app supplies a URL. `blurb` is the one line shown in a list,
`bio` the paragraphs on the detail page — the staff app must edit both.

Core invariant: one dentist cannot be double-booked. Real capacity is also limited by chairs — see open questions.

## 4. LINE integration

Not wireable yet. Everything LINE-shaped goes behind one interface with a mock implementation so the real credentials are a config change, not a rewrite.

When the accounts arrive, these must be true:

- LIFF channel and Messaging API channel **under the same provider**, otherwise the `userId` from login won't match the one push messages need.
- ID token verified server-side — never trust a `userId` sent from the client.
- LIFF endpoint needs a public HTTPS URL (a tunnel for local dev).
- Push messages are metered by the OA plan; reminders × patients × 2 must fit the monthly quota.

## 5. Design language

Set in an earlier session after a card-grid home screen was rejected as looking templated. The code is gone; the rules stand:

- **Two surfaces only**: `.slip` (white paper — the appointment record, with perforation) is the *only* elevated surface; `.ledger` (hairline-separated rows on the app surface, under an eyebrow label) for everything else. No floating pastel cards, no uniform rounded card grids.
- **Type roles**: Mitr = display, Prompt = body/UI, Mali = only when naming a child.
- **Color roles**: rose = action + slip date; lavender = structure/rules; tint discs are reserved for treatment icons, so a tint always means "treatment type". Prices are plain ink.
- **The home hero is the appointment itself**, state-aware: filled slip when one exists, same anatomy blank when not.

### Home-screen baseline (locked 2026-09-01)

The reference sheet the owner supplied replaces the slip/ledger idea *for the home screen*; the rules above still govern screens the sheet does not cover (the appointment record itself), and the type/colour roles hold everywhere.

- **Flat, not gradient.** Solid colour blocks, hairline borders, no glows or text shadows. The gradient variant is parked in `docs/archive/old-designs/gradient-skin.css` — keyed by selector, so it can be re-applied but is not a live skin. There is no skin class any more: the flat rules *are* `globals.css`.
- **One exception**: `src/components/Mascot.tsx` keeps its gradient body, clipped sheen/shade and blurred blush — the shaded tooth was picked over the flat one side by side.
- **Elastic rhythm**: `.body` gap, `.grid` gap and `.tile` padding are `clamp(min, vh, max)` so one layout fills a 932-tall phone without leaving a hole above the ribbon and still fits a 640-tall one.
- **Chrome order** inside `.app`: header (wordmark → language switch → bell) → body → full-bleed ribbon. The language switch sits in the header row immediately left of the bell; there is no separate strip above it.
- **Strings live in `src/i18n/dict.ts`**, both languages in one table typed against Thai, so a new Thai string cannot ship without its English twin. Service tiles carry only `{key, tint}`; the name is looked up by key. `Denta Kids` stays Latin in both languages — it is the brand, not copy.

### Treatment icons (locked 2026-09-01)

The staff app adds and removes treatments, so the icon set has to be a fixed
library the app picks from — not something drawn per treatment.

- **`src/data/icons.ts` is the contract.** `IconKey` (38 keys), `IconGroup` (8
  groups), `Tint` (7 disc colours), and `iconLibrary` — every key with its group
  and a suggested tint. A treatment row in Postgres will store `icon_key` +
  `tint`, both validated against this union.
- **`src/components/serviceIcons.tsx` draws them**, one `ServiceIcon k={key}`
  per key. `src/components/icons.tsx` keeps only the chrome icons (bell,
  chevrons, wordmark) — the two sets are deliberately separate files.
- **`/icons` is the internal reference page** (`robots: noindex`): the ten in use
  on the home page, then the spares by group, then the disc colours. Clicking a
  card copies its key, which is what the staff app will store. Not a patient
  page.
- **Family rules**: 24×24 box, `stroke="currentColor"`, width 1.65, round caps
  and joins, secondary detail ~1.35, solid `currentColor` for small accents.
  Every icon gets its own silhouette — a tiny mark inside an identical tooth
  outline is what made the first attempt mush together at 22px.
- **The `--halo` convention**: each `.t-*` tint class publishes its own disc
  background as `--halo`, so an icon can stroke an overlapping part in
  `var(--halo, #fff)` to punch a clean gap out of whatever sits behind it
  (badges, crossing wires, teeth that overlap). This is why the icons only work
  on a tinted disc.
- Home tiles still carry only `{key, tint}` (`src/data/services.ts`); names come
  from `dict.service[key]`, group labels from `dict.group[group]`.

### Screens past the home page (built 2026-09-01)

The reference sheet only covers the home screen. Everything else is built from
the slip/ledger system above, so the app does not turn into a card grid two
screens deep:

- **The slip is the appointment**, wherever it appears — the booking
  confirmation, the top of `/bookings`, and (blank, same anatomy) when there is
  nothing booked. One `Slip` component in `src/components/screen.tsx`; the child's
  name on it is the only Mali in the app.
- **Ledger rows for lists**: appointment history (`.histRow`), clinic hours,
  facilities. Hairline separators on the app surface under an eyebrow label — no
  card per row.
- **A tint disc always means "treatment type"**, so a dentist thumbnail is a
  round photo frame and never a tinted disc; the portrait panel on the detail
  page takes the dentist's own `tint`.
- **Unavailable is drawn, not hidden**: a full or already-past slot stays on the
  grid, dashed and struck through, so the grid does not reflow as the day fills.
  A Sunday chip says "closed" rather than vanishing.
- **`src/app/pages.css`** holds every non-home screen; `home.css` stays the
  reference sheet. Plain global CSS with `:root` tokens — no Tailwind, no
  modules. There is no heading reset, so every new rule zeroes its own margins.
- New row/slot components go at **module scope**, never defined during a render
  (`react-hooks/static-components` is on and the build runs at zero warnings).

## 6. Constraints

- Thai-first audience, with an English switch (header top-right, left of the bell; Thai default) for non-Thai parents.
- **PDPA**: records are about minors. Consent, retention and who can see what need a real answer before launch.
- The old clinic application stays the source of truth for patient records → risk of two calendars disagreeing. How the two coexist is unresolved.
- Development happens on macOS. Tauri compiles here and on Windows — the earlier WinUI 3 blocker is gone.
- Next.js in this repo is a modified build: `next dev` writes an `AGENTS.md` instructing that the guides in `node_modules/next/dist/docs/` be read before writing code. Do that; the APIs differ from common knowledge.

## Prior art

- `../dental` — v1 mockup (Vite + React + Express + JSON store): booking flow, staff schedule grid, dentist CRUD, live booking toasts, TH/EN. Slot rules already worked out there.
- `../dental/design/mockups/` — `patient-native.fig`, `worker-desktop.fig`.

---

## Open questions

**Blocking the booking flow**

1. Opening hours and days, lunch break, and slot granularity (v1 used 09:00–17:00, lunch 12:00–13:00, 30 min, Mon–Sat) — still right? **The mock currently guesses**: Mon–Thu 09:00–18:00, Fri 09:00–20:00, Sat 09:00–17:00, Sunday closed, 30-minute slots 09:00–11:30 and 13:00–16:30, bookable 14 days ahead, today's slots cut off an hour before the clock. Correct these and they change `src/data/clinic.ts` + `BookingFlow`'s `MORNING`/`AFTERNOON`/`LEAD`.
2. How many chairs/rooms? Can two patients hold the same clock time with different dentists?
3. Treatment durations — real per-treatment lengths, and who maintains them.
4. How far ahead can a parent book? Same-day allowed? Any cutoff before the slot?
5. Can a parent cancel or reschedule themselves, and until when? What should happen when they do?
6. Is the patient always a child, or can a parent book for themselves too?
7. What do we need per child: nickname, birthdate, gender, allergies, notes? Anything required for the first visit?

**Patients & the existing system**

8. What is the current management application (name/vendor)? Does it have an API, export, or reachable database?
9. Should a booking be matched to an existing patient/HN number in that system, or stay independent for now?
10. Is a phone number required at booking, and does it need verification, or is LINE login trust enough?
11. No-show handling — do you want to track it?

**Content & language**

12. ~~Thai only, or keep the TH/EN toggle?~~ → answered: bilingual TH/EN, Thai default. Remaining bit: is the English wording good enough for real foreign parents, or should a native speaker review it?
13. ~~Buddhist Era (พ.ศ.) dates for patients?~~ → built as พ.ศ. in Thai (2569) and CE in English. Confirm that is what you want on the slip.
13b. The clinic's real address, phone, LINE OA id and Google Maps place link — the map card is a drawn placeholder with a mock address until then.
14. ~~Treatment icons: choose from a built-in set, or upload your own SVG/PNG?~~ → built for a built-in set: 38 keys in `src/data/icons.ts`, browsable at `/icons`. Remaining bit: is 38 enough, or should the staff app also accept an uploaded SVG for anything the set misses?
15. Do promotions need start/end scheduling, and should a promotion link straight into a booking?
16. Are prices exact numbers or ranges ("เริ่มต้น …")?
17. Where should uploaded images live (Supabase Storage / R2 / your own server)?

**Staff app**

18. Do you have a Windows machine (and which Windows version) to build and test on? Otherwise the desktop app can only be written blind.
19. Staff roles and what each may do (admin / front desk / dentist)?
20. Must it work offline, or is always-online acceptable?
21. Should staff see live pop-ups for incoming online bookings, like the v1 mockup did?

**Notifications**

22. Reminder timing — a day before at a set hour, plus the morning of? Anything a couple of hours before?
23. Should a staff-side cancel or reschedule notify the parent automatically?
24. Marketing broadcasts (promotions) too, or transactional messages only?

**Operations**

25. Domain name, and where the web is deployed (Vercel, or Thai hosting)? Existing Vercel/Supabase/Neon account?
26. Brand assets — logo, colors, clinic and dentist photos?
27. `~/Downloads/67011096_Chayut_Panangkasiri_Dental_Management_system.pdf` — is that a requirements document for this project that I should read?

---

## Backend (built 2026-09-09)

Postgres 16 in Docker (`docker-compose.yml`, db `dentalweb`) + Drizzle ORM.
One deploy serves the LIFF pages and the API; the Tauri staff app is just a
webview pointed at `/staff`, and the queue-check site calls `/api/queue`.

| Piece | File | What it is |
|---|---|---|
| Schema | `src/db/schema.ts` | 15 tables: dentist(+text/treat/shift), treatment, guardian, child, appointment, slot_hold, clinic_day, holiday, promotion, staff_notification, waitlist_entry, message_log |
| Client | `src/db/client.ts` | pooled postgres.js + drizzle; `DATABASE_URL` from `.env` |
| Queries (DAL) | `src/server/queries.ts` | every read/availability function; `slotsForDate` is THE definition of "what is free" |
| Mutations | `src/server/actions.ts` | Server Actions (`'use server'` + `server-only`); each write revalidates affected paths |
| Converters | `src/lib/convert.ts`, `src/lib/staffConvert.ts` | DB DTOs ⇄ UI shapes so components render unchanged |
| Seed | `scripts/seed.ts` (`pnpm db:seed`) | idempotent demo data; appointment dates computed from today on each run |
| Verification | `scripts/dbTest.ts` (`pnpm db:test`) | 27 end-to-end DB checks (booking, double-booking guard, cancel, waitlist, queue board, prices, deactivation) |
| Config | `drizzle.config.ts`, `.env` | schema path + connection string; change `.env` only when moving to cloud Postgres |

**Invariants now enforced by the database**
- One dentist cannot be double-booked: unique index `(dentist_id, date, time)`;
  `bookAppointment` returns `slot_taken` on conflict.
- A booking only lands on an open day with an enabled shift for that dentist.
- Deactivating a dentist removes their slots everywhere at once.
- Patient `/bookings` and staff views read the same rows — no two calendars.
- Picking a time writes a 10-minute `slot_hold` (hold-then-confirm): a named
  hold marks that dentist's slot taken, every hold occupies a chair for pool
  capacity. Confirming consumes the hold via its token; a lapsed hold frees
  itself — every read filters on `expires_at`, no sweeper needed.

**Slot availability is real.** The mock hash-fullness in `BookingFlow` is gone;
free/taken comes from `slotsForDate` (open weekday + holiday check + shifts +
bookings). The demo seed was corrected: it used to book dentists on their days
off (piya/manee on Wednesday); each demo booking now lands on the dentist's
next working day.

**Staff console** is fed by `staffBootstrap()` (one round-trip) and every
button calls a Server Action, then re-reads state. localStorage store removed.
All `/staff/*` routes are dynamic via `connection()` in the staff layout —
`force-dynamic` exports in `"use client"` pages are ignored, so without it the
build prerenders staff pages and bakes patient data into static HTML.

**Queue flow (added 2026-09-13).** Appointment status widened to
`confirmed → arrived → in_chair → completed` (+ `cancelled`, `no_show`),
with `checked_in_at` stamped on check-in. `/staff/queue` merges checked-in
bookings with the `waitlist_entry` walk-in queue into one board
(`queueDay(date)` in queries.ts): waiting column (check-in/arrived order)
and serving column (`in_chair`). Staff actions live in `actions.ts` as
`setAppointmentQueueStatus`. The public read side is `GET /api/queue`
— `?date=` (any day: scheduled/waiting/serving/done + active dentist list),
`?dentist=slug` filter, and `?ref=`/`?phone=` lookup (`?ref=W-12` covers
walk-ins; child nickname + position only, no guardian name/phone) — and the
standalone static site in `apps/queue-site/`
(`config.js` points it at the API base).

**Commands**: `pnpm db:push` (schema → DB), `pnpm db:seed`, `pnpm db:test`,
`pnpm db:studio` (Drizzle GUI). Dev: `docker compose up -d` then `pnpm dev`.

**Known limits (deliberate for this round)**
- No staff auth (add auth before any public deploy of `/staff` — the Tauri app
  loads that URL, so the auth gate must live in the web layer).
- Patient identity = typed phone number; `/bookings` shows the demo family's
  phone (`0812345678`). LIFF login will swap this lookup, nothing else.
- LINE still mocked (credentials pending) — the interface is one file swap.
- `pnpm db:test` **deletes all appointments/waitlist/notifications then
  reseeds** — verification only, never run it against real data.
- `staffResetDemoData` shells out to `pnpm db:seed`; replace with a proper
  action before production.
