import { sql } from "drizzle-orm";

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Denta Kids — database schema.
 *
 * Conventions
 * -----------
 * · `snake_case` in Postgres, camelCase in TypeScript (drizzle maps them).
 * · Every table carries `created_at`; mutable ones also `updated_at`
 *   (maintained by `touch()` in src/db/queries.ts — one place to keep honest).
 * · Currency is integer baht — no floats for money.
 * · `IconKey`-shaped columns (treatment keys, tints, slugs) are plain text at
 *   the DB level; validation against the union types happens in the data layer,
 *   so the app can grow a new treatment without a migration.
 * · Timezone is Asia/Bangkok. A slot is `date` + `time` (clinic-local), stored
 *   as two columns rather than a timestamptz — the clinic books in wall-clock
 *   time, and this keeps "09:30" meaning 09:30 at the front desk.
 */

/* ────────────────────────────── content the patient site shows ─────────── */

/**
 * The dentist roster. The two-language profile copy lives in dentist_text
 * (one row per language) so adding Thai/English never squeezes columns.
 */
export const dentist = pgTable(
  "dentist",
  {
    id: serial("id").primaryKey(),
    /** URL key used by /dentists/[slug] and booking references */
    slug: text("slug").notNull(),
    years: integer("years").notNull().default(0),
    /** disc colour behind the portrait — validated as Tint in the data layer */
    tint: text("tint").notNull().default("lav"),
    /** drawn stand-in face (see portrait.tsx) while photos are empty */
    face: jsonb("face").notNull().default({}),
    photoSmall: text("photo_small").notNull().default(""),
    photoLarge: text("photo_large").notNull().default(""),
    /** hidden dentists drop out of the site and the booking roster */
    isActive: boolean("is_active").notNull().default(true),
    /** smaller sorts earlier in lists */
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dentist_slug_idx").on(t.slug)],
);

export const dentistText = pgTable(
  "dentist_text",
  {
    id: serial("id").primaryKey(),
    dentistId: integer("dentist_id")
      .notNull()
      .references(() => dentist.id, { onDelete: "cascade" }),
    /** "th" | "en" — kept text so a third language needs no migration */
    lang: text("lang").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    blurb: text("blurb").notNull().default(""),
    bio: text("bio").notNull().default(""),
    /** JSON array of strings */
    credentials: jsonb("credentials").notNull().default([]),
    languages: text("languages").notNull().default(""),
    /** display string like "จันทร์, พุธ, ศุกร์" — informative only; the real
     *  weekly availability lives in dentist_shift */
    days: text("days").notNull().default(""),
  },
  (t) => [uniqueIndex("dentist_text_lang_idx").on(t.dentistId, t.lang)],
);

/** who takes which treatment */
export const dentistTreat = pgTable(
  "dentist_treat",
  {
    id: serial("id").primaryKey(),
    dentistId: integer("dentist_id")
      .notNull()
      .references(() => dentist.id, { onDelete: "cascade" }),
    /** IconKey, e.g. "checkup", "braces" */
    treatmentKey: text("treatment_key").notNull(),
    /** who they see for it: "kids" (under 12), "adults", or "both" (see lib/ageGroup) */
    ages: text("ages").notNull().default("both"),
  },
  (t) => [uniqueIndex("dentist_treat_idx").on(t.dentistId, t.treatmentKey)],
);

/** weekly shift per dentist. `weekday`: 0 = Sunday … 6 = Saturday. */
export const dentistShift = pgTable(
  "dentist_shift",
  {
    id: serial("id").primaryKey(),
    dentistId: integer("dentist_id")
      .notNull()
      .references(() => dentist.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    start: text("start").notNull().default("09:00"),
    end: text("end").notNull().default("17:00"),
  },
  (t) => [uniqueIndex("dentist_shift_idx").on(t.dentistId, t.weekday)],
);

/** the treatment/price list the patient site renders */
export const treatment = pgTable(
  "treatment",
  {
    id: serial("id").primaryKey(),
    /**
     * The treatment's id, stored on every booking. Built-in rows use their
     * IconKey ("checkup"); rows the clinic adds get a "x-…" slug and pick an
     * icon below — so an icon can be reused by any number of treatments.
     */
    key: text("key").notNull(),
    /** which drawing from the icon library; null = the key itself is the icon */
    iconKey: text("icon_key"),
    /** names the clinic typed; null = the built-in name from i18n/dict.ts */
    nameTh: text("name_th"),
    nameEn: text("name_en"),
    /** disc colour + list group; null = the icon library's suggestion */
    tint: text("tint"),
    groupKey: text("group_key"),
    /** baht; null = quoted at the visit; 0 = included with the visit */
    price: integer("price"),
    durationMin: integer("duration_min").notNull().default(30),
    /** false = hidden from the patient site (still shown on old bookings) */
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("treatment_key_idx").on(t.key)],
);

/** promotions/banners for the notification & home surfaces */
export const promotion = pgTable("promotion", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  image: text("image").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────── patients ───────────────────────────────── */

/** the guardian — the account holder. LINE userId joins here at LIFF time. */
export const guardian = pgTable(
  "guardian",
  {
    id: serial("id").primaryKey(),
    /** everyday name, e.g. "คุณแม่มณฑิรา (Mon)" */
    name: text("name").notNull(),
    fullName: text("full_name").notNull().default(""),
    /** digits only, e.g. "0812345678" — the booking-flow lookup key */
    phone: text("phone").notNull(),
    lineUserId: text("line_user_id"),
    /**
     * the human-facing LINE id the desk types ("@mon_mom") — deliberately NOT
     * line_user_id: that column is the verified push target written only by
     * the LIFF link flow, and must never be overwritten by a form field.
     */
    lineContact: text("line_contact").notNull().default(""),
    /** how the guardian relates to the child — "แม่", "พ่อ", "ตนเอง" (self) */
    relation: text("relation").notNull().default(""),
    address: text("address").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** one row per phone — the booking-flow lookup key and the upsert target */
    uniqueIndex("guardian_phone_idx").on(t.phone),
    /** unique when present — one LINE account is one guardian */
    uniqueIndex("guardian_line_idx").on(t.lineUserId),
  ],
);

/** the child — the actual patient */
export const child = pgTable(
  "child",
  {
    id: serial("id").primaryKey(),
    guardianId: integer("guardian_id")
      .notNull()
      .references(() => guardian.id, { onDelete: "cascade" }),
    /** everyday display name, e.g. "น้องเจได" */
    name: text("name").notNull(),
    fullName: text("full_name").notNull().default(""),
    /** what the family calls them, e.g. "เจได" */
    nickname: text("nickname"),
    /** fallback when the exact birthdate is unknown (demo data has no DOB) */
    age: integer("age"),
    birthdate: text("birthdate"),
    gender: text("gender"),
    /** clinic running number, e.g. "DK-004821" */
    hn: text("hn"),
    bloodType: text("blood_type").notNull().default(""),
    conditions: text("conditions").notNull().default(""),
    medications: text("medications").notNull().default(""),
    allergies: text("allergies").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /** เลขบัตรประชาชน (13 digits) — typed for now, card reader later */
    idCard: text("id_card").notNull().default(""),
    /** free labels the desk filters by, e.g. ["จัดฟัน", "กลัวหมอฟัน"] */
    tags: jsonb("tags").notNull().default([]),
    /** months between check-ups; 0 = no automatic recall */
    recallMonths: integer("recall_months").notNull().default(6),
    /** who pays: "cash" | "sso" (ประกันสังคม) | "nhso" (บัตรทอง) | "gov" | "insurance" */
    coverage: text("coverage").notNull().default("cash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("child_guardian_idx").on(t.guardianId), uniqueIndex("child_name_idx").on(t.guardianId, t.name)],
);

/* ────────────────────────────── booking ────────────────────────────────── */

export type AppointmentSource = "online" | "phone" | "walkin";
/**
 * confirmed → arrived (checked in at the desk) → in_chair (being treated) →
 * completed. `no_show` and `cancelled` end the booking early. Everything except
 * `cancelled` still holds the slot (see the partial unique index below).
 */
export type AppointmentStatus =
  | "confirmed"
  | "arrived"
  | "in_chair"
  | "completed"
  | "cancelled"
  | "no_show";

export const appointment = pgTable(
  "appointment",
  {
    id: serial("id").primaryKey(),
    /** human reference, e.g. "DK-4821" */
    ref: text("ref").notNull(),
    /** null when the family is new — reception completes it at the visit */
    childId: integer("child_id").references(() => child.id, { onDelete: "set null" }),
    /** free-text child name; matches child.name when childId is set */
    childName: text("child_name").notNull(),
    guardianId: integer("guardian_id").references(() => guardian.id, { onDelete: "set null" }),
    guardianName: text("guardian_name").notNull(),
    phone: text("phone").notNull(),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "restrict" }),
    /** NULL = pooled "any dentist" booking waiting for assignment (see settlePool).
     *  Postgres treats NULLs as distinct in the unique slot index below, so any
     *  number of pooled rows can share one wall-clock slot — chairs, not the
     *  index, are what limit them. */
    treatmentKey: text("treatment_key").notNull(),
    /** clinic-local wall clock, Asia/Bangkok */
    date: text("date").notNull(), // YYYY-MM-DD
    time: text("time").notNull(), // HH:MM
    durationMin: integer("duration_min").notNull().default(30),
    source: text("source").notNull().default("online"), // AppointmentSource
    status: text("status").notNull().default("confirmed"), // AppointmentStatus
    /** HH:MM the family checked in at the desk — the queue board orders by it */
    checkedInAt: text("checked_in_at"),
    note: text("note").notNull().default(""),
    price: integer("price"),
    /** visitFor = "self" → the booker is the patient (adult), no child */
    forSelf: boolean("for_self").notNull().default(false),
    /** who the booking is for, as the family picked it: "kid" (under 12) or
     *  "adult" — null for bookings made before the question (and by staff) */
    ageGroup: text("age_group"),
    /**
     * The LINE account that made this booking (verified LIFF `sub`), and its
     * display name at booking time. Online bookings collect only a nickname +
     * phone, so this — not a guardian row — is what lists "my bookings" inside
     * LINE, where reminders go, and what the desk sees as "booked by".
     */
    lineUserId: text("line_user_id"),
    lineName: text("line_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("appointment_ref_idx").on(t.ref),
    index("appointment_line_idx").on(t.lineUserId),
    /** the double-booking guard: one dentist, one wall-clock slot — but only
     *  while the booking is live; a cancelled one frees the slot for rebooking
     *  (partial index, same predicate as the ON CONFLICT clause in queries) */
    uniqueIndex("appointment_slot_idx")
      .on(t.dentistId, t.date, t.time)
      .where(sql`status <> 'cancelled'`),
    index("appointment_date_idx").on(t.date),
    index("appointment_phone_idx").on(t.phone),
  ],
);

/**
 * A short-lived reservation made when a family picks a slot, before they
 * finish the contact details — the hold-then-confirm pattern. While a hold is
 * active (`expires_at` in the future) it counts exactly like a booking: a
 * named-dentist hold marks that dentist's slot taken, and every hold occupies
 * a chair so pooled bookings still respect capacity. Confirming deletes the
 * hold and inserts the appointment; an abandoned hold simply lapses — every
 * read filters on `expires_at`, so no sweeper is needed. The unique index on
 * (dentist_id, date, time) makes two holds for the same named slot impossible;
 * NULL dentist_id rows are pool holds, kept distinct like appointments.
 */
export const slotHold = pgTable(
  "slot_hold",
  {
    id: serial("id").primaryKey(),
    /** random token the client passes back at confirm — proves the hold is theirs */
    token: text("token").notNull(),
    /** NULL = pooled "any dentist" hold holding a chair */
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "cascade" }),
    treatmentKey: text("treatment_key").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    time: text("time").notNull(), // HH:MM
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("slot_hold_token_idx").on(t.token),
    uniqueIndex("slot_hold_slot_idx").on(t.dentistId, t.date, t.time),
    index("slot_hold_date_idx").on(t.date),
  ],
);

/** LINE push log — written by the (future) reminder scheduler */
export const messageLog = pgTable("message_log", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id").references(() => appointment.id, {
    onDelete: "set null",
  }),
  /** "confirm" | "reminder_day_before" | "reminder_morning" | "custom" */
  kind: text("kind").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  lineResponse: jsonb("line_response"),
});

/* ────────────────────────────── clinic config ──────────────────────────── */

/** weekly open/close — one row per weekday, fixed at seven */
export const clinicDay = pgTable(
  "clinic_day",
  {
    id: serial("id").primaryKey(),
    /** "sun" … "sat" */
    day: text("day").notNull(),
    isOpen: boolean("is_open").notNull().default(true),
    start: text("start").notNull().default("09:00"),
    end: text("end").notNull().default("18:00"),
  },
  (t) => [uniqueIndex("clinic_day_idx").on(t.day)],
);

/**
 * The clinic's own contact details — one row (id = 1). The patient site's
 * /clinic page and the home info card read this; the staff settings page
 * edits it. Kept to facts the front desk actually owns (phone, LINE, map,
 * address); descriptive copy stays in the i18n dictionary.
 */
export const clinicInfo = pgTable("clinic_info", {
  id: serial("id").primaryKey(),
  /** dialled as-is by the tel: link, so no spaces */
  phone: text("phone").notNull(),
  /** how the number is shown on the page, e.g. "02-123-4567" */
  phoneDisplay: text("phone_display").notNull(),
  lineId: text("line_id").notNull().default(""),
  lineUrl: text("line_url").notNull().default(""),
  /** the Google Maps pin the map card opens */
  mapUrl: text("map_url").notNull().default(""),
  directionsUrl: text("directions_url").notNull().default(""),
  addressTh: text("address_th").notNull().default(""),
  addressEn: text("address_en").notNull().default(""),
  /** the neighbourhood line under the address, per language */
  landmarkTh: text("landmark_th").notNull().default(""),
  landmarkEn: text("landmark_en").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** special closed dates, as an inclusive range */
export const holiday = pgTable("holiday", {
  id: serial("id").primaryKey(),
  start: text("start").notNull(), // YYYY-MM-DD
  end: text("end").notNull(), // YYYY-MM-DD
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Days a dentist is away (ลา), entered ahead from the staff console. On these
 * days the dentist has no bookable slots and the schedule shows them as ลา;
 * bookings already made are left alone for the desk to move or cancel.
 */
export const dentistLeave = pgTable(
  "dentist_leave",
  {
    id: serial("id").primaryKey(),
    dentistId: integer("dentist_id")
      .notNull()
      .references(() => dentist.id, { onDelete: "cascade" }),
    start: text("start").notNull(), // YYYY-MM-DD
    end: text("end").notNull(), // YYYY-MM-DD, inclusive
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dentist_leave_dentist_idx").on(t.dentistId)],
);

/**
 * Single knobs the staff console owns, as key/value rows. Only `chairs` is
 * read today: the number of treatment chairs, which caps how many live
 * bookings (assigned + pooled "any dentist") may hold one wall-clock slot —
 * the point is a patient never waits for a chair. Seeded to 3.
 */
export const clinicSetting = pgTable("clinic_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** staff-side bell: online bookings, cancellations, check-ins, reminders */
export const staffNotification = pgTable("staff_notification", {
  id: serial("id").primaryKey(),
  /** "online_booking" | "cancellation" | "reschedule" | "check_in" | "reminder" */
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  refCode: text("ref_code"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fixed-window throttle for public-facing actions, keyed by "scope:ip" (or a
 * login counter). Serverless has no shared memory, so the bucket lives here —
 * one upsert per call. Limits are generous; real users never see them.
 */
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

/** walk-in queue board (waiting → in_chair → done) */
export const waitlistEntry = pgTable("waitlist_entry", {
  id: serial("id").primaryKey(),
  childName: text("child_name").notNull(),
  guardianPhone: text("guardian_phone").notNull().default(""),
  treatmentKey: text("treatment_key").notNull(),
  dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
  /** HH:MM arrival time, clinic clock */
  arrivedAt: text("arrived_at").notNull(),
  /** "waiting" | "in_chair" | "done" */
  status: text("status").notNull().default("waiting"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What the dentist did during a visit — written on the room page (full
 * edition). One row per visit; the visit is an appointment row OR a walk-in
 * waitlist row, never both, and never neither — the partial unique indexes
 * keep it one-record-per-visit.
 */
export const visitRecord = pgTable(
  "visit_record",
  {
    id: serial("id").primaryKey(),
    appointmentId: integer("appointment_id").references(() => appointment.id, {
      onDelete: "cascade",
    }),
    waitlistId: integer("waitlist_id").references(() => waitlistEntry.id, {
      onDelete: "cascade",
    }),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    /** IconKey[] — treatments actually performed; may differ from what was booked */
    treatments: jsonb("treatments").notNull().default([]),
    /** clinical note the dentist writes — tooth, behaviour, next steps */
    detail: text("detail").notNull().default(""),
    /** baht actually charged; null = not recorded */
    price: integer("price"),
    /**
     * VisitItem[] — the same visit as billable lines: treatment, teeth, qty,
     * price each. The cashier builds the bill from these. `treatments` and
     * `price` above stay in step (keys, sum) for older readers.
     */
    items: jsonb("items").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("visit_record_appt_idx")
      .on(t.appointmentId)
      .where(sql`appointment_id IS NOT NULL`),
    uniqueIndex("visit_record_waitlist_idx")
      .on(t.waitlistId)
      .where(sql`waitlist_id IS NOT NULL`),
    index("visit_record_dentist_idx").on(t.dentistId),
  ],
);

/* ────────────────────────────── billing (full edition) ─────────────────── */

/**
 * A bill for one visit. `open` until the first payment, `partial` while a
 * balance is left, `paid` when settled, `void` when cancelled (kept, with a
 * reason, so cancelled receipts stay auditable). The receipt number is
 * handed out on the first payment and never reused.
 */
export const invoice = pgTable(
  "invoice",
  {
    id: serial("id").primaryKey(),
    /** e.g. "RC2610-0001" — null until money is taken */
    receiptNo: text("receipt_no"),
    status: text("status").notNull().default("open"),
    /** YYYY-MM-DD, clinic clock — the visit day the bill belongs to */
    date: text("date").notNull(),
    appointmentId: integer("appointment_id").references(() => appointment.id, { onDelete: "set null" }),
    waitlistId: integer("waitlist_id").references(() => waitlistEntry.id, { onDelete: "set null" }),
    childId: integer("child_id").references(() => child.id, { onDelete: "set null" }),
    patientName: text("patient_name").notNull(),
    phone: text("phone").notNull().default(""),
    /** the dentist who saw the patient — each line can still name its own */
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    /** baht off the whole bill, on top of any line discounts */
    discount: integer("discount").notNull().default(0),
    /** the treatment plan / contract this bill pays towards (ortho instalments) */
    planId: integer("plan_id"),
    /** "visit" (treatment/products) | "deposit" (money kept on account — not revenue) */
    kind: text("kind").notNull().default("visit"),
    note: text("note").notNull().default(""),
    voidReason: text("void_reason").notNull().default(""),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    /** when the balance reached zero */
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** when the after-visit LINE message (care advice / thanks) went out */
    careSentAt: timestamp("care_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoice_receipt_idx").on(t.receiptNo),
    index("invoice_date_idx").on(t.date),
    uniqueIndex("invoice_appt_idx")
      .on(t.appointmentId)
      .where(sql`appointment_id IS NOT NULL AND status <> 'void'`),
    uniqueIndex("invoice_waitlist_idx")
      .on(t.waitlistId)
      .where(sql`waitlist_id IS NOT NULL AND status <> 'void'`),
  ],
);

/** one line on a bill — price, discount and the dentist fee are frozen here */
export const invoiceItem = pgTable(
  "invoice_item",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    /** null = a free-text line (a product, a lab fee…) */
    treatmentKey: text("treatment_key"),
    name: text("name").notNull(),
    /** tooth numbers as the dentist wrote them, e.g. "54 55" */
    teeth: text("teeth").notNull().default(""),
    qty: integer("qty").notNull().default(1),
    unitPrice: integer("unit_price").notNull().default(0),
    /** baht off this line */
    discount: integer("discount").notNull().default(0),
    /** what the lab charged — taken off before a percentage DF */
    labCost: integer("lab_cost").notNull().default(0),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    /** the doctor fee for this line, worked out when the line is saved */
    df: integer("df").notNull().default(0),
    /** a product sold off the shelf — taken out of stock when the bill is paid */
    stockItemId: integer("stock_item_id"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("invoice_item_invoice_idx").on(t.invoiceId)],
);

/** money received against a bill — a bill can be paid in several parts/ways */
export const payment = pgTable(
  "payment",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    /** "cash" | "transfer" | "promptpay" | "card" | "other" */
    method: text("method").notNull(),
    amount: integer("amount").notNull(),
    /** YYYY-MM-DD, clinic clock — the day close counts it on this day */
    date: text("date").notNull(),
    note: text("note").notNull().default(""),
    /** claim payments (SSO / NHSO / insurer): "pending" | "submitted" | "paid" | "rejected" */
    claimStatus: text("claim_status").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payment_invoice_idx").on(t.invoiceId), index("payment_date_idx").on(t.date)],
);

/**
 * How a dentist is paid per treatment. The most specific rule wins:
 * dentist + treatment → treatment (any dentist) → dentist (any treatment) →
 * clinic default (both null). "percent" = % of the line after discounts and
 * lab cost; "fixed" = baht per unit.
 */
export const dfRule = pgTable(
  "df_rule",
  {
    id: serial("id").primaryKey(),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "cascade" }),
    treatmentKey: text("treatment_key"),
    mode: text("mode").notNull().default("percent"),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("df_rule_idx").on(t.dentistId, t.treatmentKey).nullsNotDistinct()],
);

/* ────────────────────────────── clinical (full edition) ────────────────── */

/**
 * The dental chart — one row per tooth that has anything recorded, FDI
 * numbering (11–48 permanent, 51–85 primary). `surfaces` holds the faces
 * involved: M O D B L (I for front teeth).
 */
export const toothState = pgTable(
  "tooth_state",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    tooth: text("tooth").notNull(),
    /** "sound" "caries" "filled" "sealant" "pulpotomy" "rct" "crown" "ssc"
     *  "missing" "extracted" "unerupted" "mobile" "impacted" "bridge" "implant" */
    status: text("status").notNull(),
    surfaces: jsonb("surfaces").notNull().default([]),
    note: text("note").notNull().default(""),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tooth_state_idx").on(t.childId, t.tooth)],
);

/** every change to a tooth, newest last — the chart's history */
export const toothEvent = pgTable(
  "tooth_event",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    tooth: text("tooth").notNull(),
    status: text("status").notNull(),
    surfaces: jsonb("surfaces").notNull().default([]),
    note: text("note").notNull().default(""),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tooth_event_child_idx").on(t.childId)],
);

/**
 * A treatment plan, which doubles as the estimate (ใบเสนอราคา) the family
 * takes home. `kind: "contract"` is an agreed package price paid off over
 * many visits (ortho) — bills carrying its id count towards it.
 */
export const treatmentPlan = pgTable(
  "treatment_plan",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("plan"),
    /** "draft" | "accepted" | "in_progress" | "done" | "cancelled" */
    status: text("status").notNull().default("draft"),
    /** contract only: the agreed price for the whole course */
    agreedTotal: integer("agreed_total"),
    /** the family's signature accepting the estimate (PNG data URL) */
    signature: text("signature").notNull().default(""),
    signedBy: text("signed_by").notNull().default(""),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("treatment_plan_child_idx").on(t.childId)],
);

export const planItem = pgTable(
  "plan_item",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => treatmentPlan.id, { onDelete: "cascade" }),
    treatmentKey: text("treatment_key"),
    name: text("name").notNull(),
    teeth: text("teeth").notNull().default(""),
    qty: integer("qty").notNull().default(1),
    unitPrice: integer("unit_price").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    /** "planned" | "done" | "cancelled" */
    status: text("status").notNull().default("planned"),
    doneAt: text("done_at"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("plan_item_plan_idx").on(t.planId)],
);

/**
 * Money a family keeps with the clinic — a deposit in (+), spent on a bill
 * (−). The balance is the sum. Spending it is the "credit" payment method.
 */
export const patientCredit = pgTable(
  "patient_credit",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    invoiceId: integer("invoice_id").references(() => invoice.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_credit_child_idx").on(t.childId)],
);

/** the clinic's drug list — what a prescription picks from */
export const medication = pgTable("medication", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** e.g. "250 mg/5 ml" */
  strength: text("strength").notNull().default(""),
  /** e.g. "ขวด", "เม็ด" */
  unit: text("unit").notNull().default(""),
  /** default directions, e.g. "รับประทานครั้งละ 5 ml วันละ 3 ครั้ง หลังอาหาร" */
  sig: text("sig").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Printed paperwork kept on the patient's file: prescriptions, medical
 * certificates, referrals, consent forms. `data` holds the form's fields;
 * `kind` says which form.
 */
export const clinicalDoc = pgTable(
  "clinical_doc",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    /** "prescription" | "certificate" | "referral" | "consent" | "note" */
    kind: text("kind").notNull(),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clinical_doc_child_idx").on(t.childId)],
);

/** photos, X-rays and scanned papers on a patient's file (base64 body) */
export const patientFile = pgTable(
  "patient_file",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    /** "photo" | "xray" | "document" */
    kind: text("kind").notNull().default("photo"),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    body: text("body").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_file_child_idx").on(t.childId)],
);

/** who is due back for a check-up, and what the desk did about it */
export const recall = pgTable(
  "recall",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => child.id, { onDelete: "cascade" }),
    dueDate: text("due_date").notNull(),
    reason: text("reason").notNull().default("ตรวจสุขภาพฟันตามรอบ"),
    /** "due" | "contacted" | "booked" | "done" | "skipped" */
    status: text("status").notNull().default("due"),
    contactNote: text("contact_note").notNull().default(""),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recall_due_idx").on(t.dueDate), index("recall_child_idx").on(t.childId)],
);

/* ────────────────────────────── stock, expenses, labs (full edition) ───── */

/** who the clinic buys from — suppliers, and dental labs (kind "lab") */
export const supplier = pgTable("supplier", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** "supplier" | "lab" */
  kind: text("kind").notNull().default("supplier"),
  phone: text("phone").notNull().default(""),
  contact: text("contact").notNull().default(""),
  note: text("note").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** something on the shelf: a material, a drug, or a product sold to families */
export const stockItem = pgTable("stock_item", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** "material" | "drug" | "product" | "other" */
  category: text("category").notNull().default("material"),
  unit: text("unit").notNull().default("ชิ้น"),
  /** baht per unit we pay */
  cost: integer("cost").notNull().default(0),
  /** baht per unit we charge (products) */
  price: integer("price").notNull().default(0),
  /** warn when the count falls to this */
  minQty: integer("min_qty").notNull().default(0),
  /** current count — kept in step with stock_move */
  qty: integer("qty").notNull().default(0),
  /** shows in the cashier's list to sell */
  sellable: boolean("sellable").notNull().default(false),
  supplierId: integer("supplier_id").references(() => supplier.id, { onDelete: "set null" }),
  note: text("note").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** every change to a count: received, used in treatment, sold, adjusted, expired */
export const stockMove = pgTable(
  "stock_move",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => stockItem.id, { onDelete: "cascade" }),
    /** + in, − out */
    change: integer("change").notNull(),
    /** "receive" | "use" | "sell" | "adjust" | "expire" | "return" */
    kind: text("kind").notNull(),
    unitCost: integer("unit_cost").notNull().default(0),
    /** the bill that used or sold it */
    invoiceId: integer("invoice_id").references(() => invoice.id, { onDelete: "set null" }),
    lot: text("lot").notNull().default(""),
    /** YYYY-MM-DD, received stock only */
    expiry: text("expiry"),
    note: text("note").notNull().default(""),
    /** YYYY-MM-DD, clinic clock */
    date: text("date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_move_item_idx").on(t.itemId), index("stock_move_invoice_idx").on(t.invoiceId)],
);

/** what a treatment uses up — taken out of stock when its bill is paid */
export const treatmentConsumable = pgTable(
  "treatment_consumable",
  {
    id: serial("id").primaryKey(),
    treatmentKey: text("treatment_key").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => stockItem.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(1),
  },
  (t) => [uniqueIndex("treatment_consumable_idx").on(t.treatmentKey, t.itemId)],
);

/** money going out: rent, salaries, supplies, utilities… */
export const expense = pgTable(
  "expense",
  {
    id: serial("id").primaryKey(),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    category: text("category").notNull(),
    amount: integer("amount").notNull(),
    supplierId: integer("supplier_id").references(() => supplier.id, { onDelete: "set null" }),
    method: text("method").notNull().default("cash"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expense_date_idx").on(t.date)],
);

/** work sent to a dental lab — crowns, space maintainers, retainers… */
export const labOrder = pgTable(
  "lab_order",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id").references(() => child.id, { onDelete: "set null" }),
    patientName: text("patient_name").notNull(),
    labId: integer("lab_id").references(() => supplier.id, { onDelete: "set null" }),
    dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
    work: text("work").notNull(),
    teeth: text("teeth").notNull().default(""),
    shade: text("shade").notNull().default(""),
    /** YYYY-MM-DD dates */
    sentDate: text("sent_date").notNull(),
    dueDate: text("due_date"),
    receivedDate: text("received_date"),
    cost: integer("cost").notNull().default(0),
    /** "sent" | "received" | "fitted" | "remake" | "cancelled" */
    status: text("status").notNull().default("sent"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lab_order_status_idx").on(t.status)],
);

/* ────────────────────────────── staff accounts (full edition) ──────────── */

/**
 * Who is using the app. The clinic PIN still unlocks a device; on top of it
 * each person signs in with their own short PIN, and their role decides what
 * they can open. No rows = the app runs open, as before.
 */
export const staffUser = pgTable("staff_user", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** "owner" | "frontdesk" | "dentist" | "assistant" */
  role: text("role").notNull().default("frontdesk"),
  /** sha256 of a per-user salt + the PIN */
  pinHash: text("pin_hash").notNull(),
  salt: text("salt").notNull(),
  dentistId: integer("dentist_id").references(() => dentist.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** who did what — payments, cancellations, chart and settings changes */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    userName: text("user_name").notNull().default(""),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_at_idx").on(t.createdAt)],
);

/** ลงเวลาทำงาน — each person clocks in and out with their own PIN */
export const timeClock = pgTable(
  "time_clock",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => staffUser.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD the shift started, clinic clock */
    date: text("date").notNull(),
    inAt: timestamp("in_at", { withTimezone: true }).notNull().defaultNow(),
    outAt: timestamp("out_at", { withTimezone: true }),
  },
  (t) => [index("time_clock_user_idx").on(t.userId), index("time_clock_date_idx").on(t.date)],
);

/* ────────────────────────────── LINE chat (full edition) ───────────────── */

/** a LINE account that has written to the clinic's OA */
export const lineContact = pgTable("line_contact", {
  lineUserId: text("line_user_id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  pictureUrl: text("picture_url").notNull().default(""),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** every message in and out of the OA chat, as the app saw it */
export const lineMessage = pgTable(
  "line_message",
  {
    id: serial("id").primaryKey(),
    lineUserId: text("line_user_id").notNull(),
    /** "in" from the family, "out" from the clinic */
    direction: text("direction").notNull(),
    /** "text" | "sticker" | "image" | "other" */
    kind: text("kind").notNull().default("text"),
    text: text("text").notNull().default(""),
    /** who at the clinic sent it (out) */
    staffName: text("staff_name").notNull().default(""),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("line_message_user_idx").on(t.lineUserId, t.createdAt)],
);
