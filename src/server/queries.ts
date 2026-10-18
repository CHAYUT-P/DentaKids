/**
 * NOTE: no `server-only` import here on purpose — the seed and verification
import type { TreatmentKey } from "@/lib/treatments";
 * scripts import these same query functions outside Next.js. The credential
 * boundary is src/db/index.ts (which does carry `server-only`); this file
 * only ever runs on the server in the app because only server code imports it.
 */

import { and, asc, desc, eq, getTableColumns, type AnyColumn, gt, gte, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";

import type { IconKey } from "@/data/icons";
import { isIconKey } from "@/data/icons";
import { addDays, minutesOf, todayISO, weekday, weekdayIndex } from "@/lib/dates";
import { agesAllow, isAgeGroup, isTreatAges, type AgeGroup, type TreatAges } from "@/lib/ageGroup";
import { newTreatmentKey, toTreatmentInfo, type TreatmentInfo, type TreatmentKey } from "@/lib/treatments";
import type { PatientChildInput, PatientUpsertInput, VisitItem } from "@/lib/staffTypes";
/**
 * The client instance is imported directly (not via "@/db", whose `server-only`
 * guard would also block the seed/verification scripts that legitimately reuse
 * these queries outside Next.js). Same builder, same env var.
 */
import { db } from "@/db/client";
import {
  appointment,
  child,
  clinicDay,
  clinicInfo,
  clinicSetting,
  dentist,
  dentistShift,
  dentistLeave,
  dentistText,
  dentistTreat,
  guardian,
  holiday,
  rateLimit,
  slotHold,
  staffNotification,
  treatment,
  visitRecord,
  waitlistEntry,
  type AppointmentSource,
  type AppointmentStatus,
} from "@/db/schema";

/**
 * The Data Access Layer — the only module that talks to Postgres.
 *
 * Pages and server actions import from here; nothing else touches `db`
 * directly. Every function is small, named after what it returns, and returns
 * plain serialisable objects (DTOs) so they can cross the server/client
 * boundary safely.
 */

/* ══════════════════════════════════ shapes ══════════════════════════════ */

/** what the UI needs about a dentist — the two-language profile flattened */
export interface DentistDTO {
  id: number;
  slug: string;
  years: number;
  tint: string;
  face: Record<string, unknown>;
  photoSmall: string;
  photoLarge: string;
  isActive: boolean;
  treats: IconKey[];
  /** per treatment, who they see — only entries that aren't "both" */
  treatAges: Partial<Record<string, TreatAges>>;
  shifts: { weekday: number; enabled: boolean; start: string; end: string }[];
  text: Record<"th" | "en", DentistTextDTO>;
}

export interface DentistTextDTO {
  name: string;
  title: string;
  blurb: string;
  bio: string;
  credentials: string[];
  languages: string;
  days: string;
}

export interface TreatmentDTO {
  key: IconKey;
  price: number | null;
  durationMin: number;
}

export interface ClinicDayDTO {
  day: string;
  isOpen: boolean;
  start: string;
  end: string;
}

export interface HolidayDTO {
  id: number;
  start: string;
  end: string;
  name: string;
}

export interface AppointmentDTO {
  id: number;
  ref: string;
  date: string;
  time: string;
  durationMin: number;
  childId: number | null;
  childName: string;
  guardianId: number | null;
  guardianName: string;
  phone: string;
  /** null = pooled "any dentist" booking still waiting for assignment */
  dentistId: number | null;
  dentistSlug: string;
  dentistName: string;
  treatmentKey: TreatmentKey;
  source: AppointmentSource;
  status: AppointmentStatus;
  /** HH:MM the family checked in — set when status moves to "arrived" */
  checkedInAt: string | null;
  note: string;
  price: number | null;
  forSelf: boolean;
  /** "kid" / "adult" as the family picked it; null = not asked (older or staff bookings) */
  ageGroup: AgeGroup | null;
  /** LINE display name of the account that booked ("" = not booked in LINE) */
  lineName: string;
  /** the booking carries a LINE account the clinic can message */
  hasLine: boolean;
}

export interface GuardianDTO {
  id: number;
  name: string;
  fullName: string;
  /** "แม่" | "พ่อ" | "ตนเอง" … — who the guardian is to the child */
  relation: string;
  phone: string;
  lineUserId: string | null;
  /** the typed-in LINE id — display only; the push id is lineUserId */
  lineContact: string;
  address: string;
  children: {
    id: number;
    name: string;
    fullName: string;
    nickname: string | null;
    birthdate: string | null;
    age: number | null;
    allergies: string;
    notes: string;
    conditions: string;
    medications: string;
    hn: string | null;
    gender: string | null;
    bloodType: string;
    idCard: string;
    tags: string[];
    recallMonths: number;
    coverage: string;
  }[];
  registeredAt: string;
}

export interface VisitRecordDTO {
  id: number;
  /** the booking this visit came from — XOR waitlistId */
  appointmentId: number | null;
  /** the walk-in queue row this visit came from — XOR appointmentId */
  waitlistId: number | null;
  dentistId: number | null;
  dentistSlug: string | null;
  /** IconKey[] — treatments actually performed */
  treatments: string[];
  detail: string;
  price: number | null;
  items: VisitItem[];
  updatedAt: string;
}

export interface WaitlistDTO {
  id: number;
  childName: string;
  guardianPhone: string;
  treatmentKey: TreatmentKey;
  dentistId: number | null;
  dentistSlug: string | null;
  arrivedAt: string;
  status: "waiting" | "in_chair" | "done";
  note: string;
}

export interface NotificationDTO {
  id: number;
  type: string;
  title: string;
  body: string;
  refCode: string | null;
  isRead: boolean;
  createdAt: string;
}

/* ══════════════════════════════════ mappers ═════════════════════════════ */

function asIconKey(k: string): IconKey {
  return k as IconKey;
}

/* ═══════════════════════════════ dentists ═══════════════════════════════ */

/** an uploaded photo's address (versioned by the last edit), or the stored value as is */
function photoUrl(slug: string, size: "small" | "large", stored: string, updatedAt: Date): string {
  return stored === "data:" ? `/api/dentist-photo/${slug}/${size}?v=${updatedAt.getTime()}` : stored;
}

export async function listDentists(): Promise<DentistDTO[]> {
  // an uploaded photo (a data URL) never leaves here inline — only a marker,
  // turned into its /api/dentist-photo address below
  const photoCol = (c: AnyColumn) =>
    sql<string>`case when left(${c}, 5) = 'data:' then 'data:' else ${c} end`;
  const [rows, texts, treats, shifts] = await Promise.all([
    db
      .select({ ...getTableColumns(dentist), photoSmall: photoCol(dentist.photoSmall), photoLarge: photoCol(dentist.photoLarge) })
      .from(dentist)
      .orderBy(asc(dentist.sort), asc(dentist.id)),
    db.select().from(dentistText),
    db.select().from(dentistTreat),
    db.select().from(dentistShift).orderBy(asc(dentistShift.weekday)),
  ]);

  return rows.map((d) => {
    const textRows = texts.filter((t) => t.dentistId === d.id);
    const th = textRows.find((t) => t.lang === "th");
    const en = textRows.find((t) => t.lang === "en");
    const mapText = (t?: typeof th): DentistTextDTO => ({
      name: t?.name ?? "",
      title: t?.title ?? "",
      blurb: t?.blurb ?? "",
      bio: t?.bio ?? "",
      credentials: (t?.credentials as string[]) ?? [],
      languages: t?.languages ?? "",
      days: t?.days ?? "",
    });
    return {
      id: d.id,
      slug: d.slug,
      years: d.years,
      tint: d.tint,
      face: (d.face as Record<string, unknown>) ?? {},
      photoSmall: photoUrl(d.slug, "small", d.photoSmall, d.updatedAt),
      photoLarge: photoUrl(d.slug, "large", d.photoLarge, d.updatedAt),
      isActive: d.isActive,
      treats: treats.filter((t) => t.dentistId === d.id).map((t) => asIconKey(t.treatmentKey)),
      treatAges: Object.fromEntries(
        treats
          .filter((t) => t.dentistId === d.id && isTreatAges(t.ages) && t.ages !== "both")
          .map((t) => [t.treatmentKey, t.ages as TreatAges]),
      ),
      shifts: shifts
        .filter((s) => s.dentistId === d.id)
        .map((s) => ({ weekday: s.weekday, enabled: s.enabled, start: s.start, end: s.end })),
      text: { th: mapText(th), en: mapText(en) },
    };
  });
}

/** patient-facing list — deactivated dentists stay staff-only */
export async function listActiveDentists(): Promise<DentistDTO[]> {
  return (await listDentists()).filter((d) => d.isActive);
}

/* ═══════════════════════════════ treatments ═════════════════════════════ */

export async function listTreatments(): Promise<TreatmentDTO[]> {
  const rows = await db
    .select()
    .from(treatment)
    .where(eq(treatment.isActive, true))
    .orderBy(asc(treatment.sort), asc(treatment.id));
  return rows.map((t) => ({
    key: asIconKey(t.key),
    price: t.price,
    durationMin: t.durationMin,
  }));
}

/**
 * Every treatment, shown or hidden, resolved for display (names, icon, tint,
 * group with built-in fallbacks). The patient site filters `isActive`; the
 * staff console shows all of them.
 */
export async function listTreatmentCatalog(): Promise<TreatmentInfo[]> {
  const rows = await db.select().from(treatment).orderBy(asc(treatment.sort), asc(treatment.id));
  return rows.map(toTreatmentInfo);
}

export interface TreatmentInput {
  nameTh: string;
  nameEn?: string;
  iconKey: IconKey;
  tint?: string;
  groupKey?: string;
  price: number | null;
}

/** a treatment the clinic adds: its own key, typed names, a library icon */
export async function createTreatment(input: TreatmentInput): Promise<string> {
  const keys = new Set((await db.select({ key: treatment.key }).from(treatment)).map((r) => r.key));
  let key = newTreatmentKey();
  while (keys.has(key)) key = newTreatmentKey();
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${treatment.sort}), 0)` }).from(treatment);
  await db.insert(treatment).values({
    key,
    iconKey: input.iconKey,
    nameTh: input.nameTh.trim(),
    nameEn: input.nameEn?.trim() || null,
    tint: input.tint ?? null,
    groupKey: input.groupKey ?? null,
    price: input.price,
    isActive: true,
    sort: Number(max) + 1,
  });
  return key;
}

export interface TreatmentPatch {
  nameTh?: string | null;
  nameEn?: string | null;
  iconKey?: IconKey;
  tint?: string | null;
  groupKey?: string | null;
  price?: number | null;
  showPrice?: boolean;
  isActive?: boolean;
}

/** edit any treatment — built-in ones too (a typed name overrides the default) */
export async function updateTreatment(key: string, patch: TreatmentPatch): Promise<void> {
  const set: Partial<typeof treatment.$inferInsert> = { updatedAt: new Date() };
  if (patch.nameTh !== undefined) set.nameTh = patch.nameTh?.trim() || null;
  if (patch.nameEn !== undefined) set.nameEn = patch.nameEn?.trim() || null;
  if (patch.iconKey !== undefined) set.iconKey = patch.iconKey;
  if (patch.tint !== undefined) set.tint = patch.tint;
  if (patch.groupKey !== undefined) set.groupKey = patch.groupKey;
  if (patch.price !== undefined) set.price = patch.price;
  if (patch.showPrice !== undefined) set.showPrice = patch.showPrice;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  await db.update(treatment).set(set).where(eq(treatment.key, key));
}

/** show or hide every price on the patient site in one go */
export async function setAllShowPrice(show: boolean): Promise<void> {
  await db.update(treatment).set({ showPrice: show, updatedAt: new Date() });
}

/** can a family book this right now? It must exist and be shown on the website */
export async function isBookableTreatment(key: string): Promise<boolean> {
  const rows = await db
    .select({ on: treatment.isActive })
    .from(treatment)
    .where(eq(treatment.key, key));
  return rows[0]?.on === true;
}

/* ═══════════════════════════════ dentist leave ══════════════════════════ */

export interface DentistLeaveDTO {
  id: number;
  dentistId: number;
  dentistSlug: string;
  start: string;
  end: string;
  note: string;
}

/** leave that hasn't ended yet (plus the last 30 days, for reference) */
export async function listDentistLeaves(): Promise<DentistLeaveDTO[]> {
  const since = addDays(todayISO(), -30);
  const rows = await db
    .select({ l: dentistLeave, slug: dentist.slug })
    .from(dentistLeave)
    .innerJoin(dentist, eq(dentist.id, dentistLeave.dentistId))
    .where(gte(dentistLeave.end, since))
    .orderBy(asc(dentistLeave.start));
  return rows.map((r) => ({
    id: r.l.id,
    dentistId: r.l.dentistId,
    dentistSlug: r.slug,
    start: r.l.start,
    end: r.l.end,
    note: r.l.note,
  }));
}

export async function addDentistLeave(dentistSlug: string, start: string, end: string, note: string): Promise<boolean> {
  const d = await db.select({ id: dentist.id }).from(dentist).where(eq(dentist.slug, dentistSlug));
  if (!d[0]) return false;
  const [s, e] = start <= end ? [start, end] : [end, start];
  await db.insert(dentistLeave).values({ dentistId: d[0].id, start: s, end: e, note: note.trim() });
  return true;
}

export async function removeDentistLeave(id: number): Promise<void> {
  await db.delete(dentistLeave).where(eq(dentistLeave.id, id));
}

/** price map keyed by IconKey — the shape the staff console edits */
export async function priceMap(): Promise<Record<IconKey, number | null>> {
  const rows = await db.select().from(treatment);
  const out = {} as Record<IconKey, number | null>;
  for (const r of rows) out[asIconKey(r.key)] = r.price;
  return out;
}

/* ═══════════════════════════════ clinic config ══════════════════════════ */

export async function listClinicDays(): Promise<ClinicDayDTO[]> {
  return db
    .select({ day: clinicDay.day, isOpen: clinicDay.isOpen, start: clinicDay.start, end: clinicDay.end })
    .from(clinicDay)
    .orderBy(asc(clinicDay.id));
}

export async function listHolidays(): Promise<HolidayDTO[]> {
  const rows = await db.select().from(holiday).orderBy(asc(holiday.start));
  return rows.map((h) => ({ id: h.id, start: h.start, end: h.end, name: h.name }));
}

/* ─────────────────────────── clinic contact info ───────────────────────── */

export interface ClinicInfoDTO {
  phone: string;
  phoneDisplay: string;
  lineId: string;
  lineUrl: string;
  mapUrl: string;
  directionsUrl: string;
  addressTh: string;
  addressEn: string;
  landmarkTh: string;
  landmarkEn: string;
}

/** the single clinic_info row, or null when never seeded */
export async function getClinicInfo(): Promise<ClinicInfoDTO | null> {
  const rows = await db.select().from(clinicInfo).where(eq(clinicInfo.id, 1));
  const r = rows[0];
  if (!r) return null;
  return {
    phone: r.phone,
    phoneDisplay: r.phoneDisplay,
    lineId: r.lineId,
    lineUrl: r.lineUrl,
    mapUrl: r.mapUrl,
    directionsUrl: r.directionsUrl,
    addressTh: r.addressTh,
    addressEn: r.addressEn,
    landmarkTh: r.landmarkTh,
    landmarkEn: r.landmarkEn,
  };
}

export async function updateClinicInfo(patch: Partial<ClinicInfoDTO>): Promise<void> {
  await db
    .update(clinicInfo)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(clinicInfo.id, 1));
}

/* ═══════════════════════════════ availability ═══════════════════════════ */

/**
 * The bookable slot grid: every enabled dentist-shift on an open day gets one
 * row; a slot the dentist already has an appointment in is marked taken.
 * The patient calendar AND the staff schedule read from this one definition,
 * so they can never disagree about what is free.
 */
export interface SlotRow {
  dentistId: number;
  dentistSlug: string;
  time: string; // HH:MM
  taken: boolean;
}

export async function slotsForDate(date: string): Promise<SlotRow[]> {
  const weekdayKey = weekday(date);
  const weekdayNum = weekdayIndex(date);

  const [days, daysOff] = await Promise.all([
    db.select().from(clinicDay).where(eq(clinicDay.day, weekdayKey)),
    db
      .select()
      .from(holiday)
      .where(and(lte(holiday.start, date), gte(holiday.end, date))),
  ]);

  const open = days[0]?.isOpen && daysOff.length === 0;
  if (!open) return [];

  const roster = await db
    .select({ id: dentist.id, slug: dentist.slug })
    .from(dentist)
    .where(eq(dentist.isActive, true));

  // a dentist on leave (ลา) that day has no slots at all
  const away = new Set(
    (
      await db
        .select({ id: dentistLeave.dentistId })
        .from(dentistLeave)
        .where(and(lte(dentistLeave.start, date), gte(dentistLeave.end, date)))
    ).map((l) => l.id),
  );
  const active = roster.filter((d) => !away.has(d.id));

  if (active.length === 0) return [];

  const activeIds = active.map((a) => a.id);
  const shifts = await db
    .select()
    .from(dentistShift)
    .where(and(eq(dentistShift.enabled, true), inArray(dentistShift.dentistId, activeIds)));

  const booked = await db
    .select({ dentistId: appointment.dentistId, time: appointment.time })
    .from(appointment)
    .where(and(eq(appointment.date, date), ne(appointment.status, "cancelled")));

  const takenSet = new Set(booked.map((b) => `${b.dentistId}:${b.time}`));

  // an active slot hold blocks that named dentist's slot exactly like a booking
  const held = await db
    .select({ dentistId: slotHold.dentistId, time: slotHold.time })
    .from(slotHold)
    .where(and(eq(slotHold.date, date), gt(slotHold.expiresAt, new Date())));
  for (const h of held) {
    if (h.dentistId !== null) takenSet.add(`${h.dentistId}:${h.time}`);
  }

  const out: SlotRow[] = [];
  for (const d of active) {
    // only this weekday's shift — never the other six rows
    const shift = shifts.find((s) => s.dentistId === d.id && s.weekday === weekdayNum);
    if (!shift) continue;
    const startM = minutesOf(shift.start);
    const endM = minutesOf(shift.end);
    for (let m = startM; m + 30 <= endM; m += 30) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      out.push({
        dentistId: d.id,
        dentistSlug: d.slug,
        time: hhmm,
        taken: takenSet.has(`${d.id}:${hhmm}`),
      });
    }
  }
  return out;
}

/** does any active dentist still have a free 30-min slot on this date? */
export async function dateHasRoom(date: string, today: string, nowMin: number): Promise<boolean> {
  if (date < today) return false;
  const slots = await slotsForDate(date);
  const leadMin = date === today ? nowMin + 60 : -1;
  return slots.some((s) => !s.taken && minutesOf(s.time) > leadMin);
}

/* ═══════════════════════════════ pool ("any dentist") ════════════════════ */
/**
 * Pooled bookings are appointments with dentist_id NULL: the parent picked a
 * time but no dentist. They consume a chair like any booking, and the staff
 * console (or settlePool below) assigns them a dentist afterwards.
 *
 * The three rules, agreed with the clinic:
 * 1. A specific-dentist booking is always allowed while that dentist is free
 *    — the pool never reserves or blocks a dentist (first-come wins).
 * 2. An "any dentist" booking joins the pool while live bookings (assigned +
 *    pooled, every treatment — chairs are shared) stay under the chair count.
 * 3. settlePool is the pressure valve: it runs after every booking change at
 *    a slot and assigns the oldest pooled booking whenever the slot is at
 *    chair capacity and a capable dentist is still free. With room to spare
 *    the pool waits for the staff to place it by hand.
 */

export async function getChairs(): Promise<number> {
  const rows = await db.select().from(clinicSetting).where(eq(clinicSetting.key, "chairs"));
  const n = Number(rows[0]?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

export async function setChairs(n: number): Promise<void> {
  const chairs = Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "3";
  await db
    .insert(clinicSetting)
    .values({ key: "chairs", value: chairs })
    .onConflictDoUpdate({ target: clinicSetting.key, set: { value: chairs, updatedAt: new Date() } });
}

/** the routine visits every dentist takes — mirrors convert.ts (client copy) */
const GENERAL_TREATS: IconKey[] = ["checkup", "consult", "followup"];

/**
 * ids of active dentists who take this treatment (routine visits: everyone),
 * narrowed to those who see this age group when one is given — a dentist who
 * takes braces for adults only is not offered for a kid's braces.
 */
export async function capableDentistIds(treatmentKey: TreatmentKey, group?: AgeGroup | null): Promise<number[]> {
  const active = await db
    .select({ id: dentist.id })
    .from(dentist)
    .where(eq(dentist.isActive, true));
  const claimed = await db
    .select({ id: dentistTreat.dentistId, ages: dentistTreat.ages })
    .from(dentistTreat)
    .where(eq(dentistTreat.treatmentKey, treatmentKey));
  const agesOf = new Map(claimed.map((c) => [c.id, isTreatAges(c.ages) ? c.ages : undefined]));
  let ids: number[];
  if ((GENERAL_TREATS as string[]).includes(treatmentKey)) {
    ids = active.map((a) => a.id);
  } else {
    const able = active.map((a) => a.id).filter((id) => agesOf.has(id));
    // a treatment nobody claims yet stays bookable with anyone, like the roster UI
    ids = able.length > 0 ? able : active.map((a) => a.id);
  }
  return ids.filter((id) => agesAllow(agesOf.get(id), group));
}

export interface SlotLiveRow {
  id: number;
  treatmentKey: TreatmentKey;
  ageGroup: AgeGroup | null;
  dentistId: number | null;
  createdAt: Date;
}

export interface SlotLoad {
  /** live bookings (assigned + pooled, every treatment) holding this time */
  live: number;
  /** of which, still waiting for a dentist */
  pool: number;
}

/**
 * Chair load for whole dates at once: the booking calendar's "any dentist"
 * mode admits a time while live < chairs, so it needs these counts, not the
 * per-dentist taken flags. One query per call, grouped here.
 */
export async function slotLoadForDates(dates: string[]): Promise<Record<string, Record<string, SlotLoad>>> {
  const out: Record<string, Record<string, SlotLoad>> = {};
  if (dates.length === 0) return out;
  const rows = await db
    .select({
      date: appointment.date,
      time: appointment.time,
      dentistId: appointment.dentistId,
    })
    .from(appointment)
    .where(and(inArray(appointment.date, dates), ne(appointment.status, "cancelled")));
  for (const r of rows) {
    const day = (out[r.date] ??= {});
    const cell = (day[r.time] ??= { live: 0, pool: 0 });
    cell.live += 1;
    if (r.dentistId === null) cell.pool += 1;
  }

  // active holds occupy chairs too, so a held time can't look free on the calendar
  const holds = await db
    .select({ date: slotHold.date, time: slotHold.time, dentistId: slotHold.dentistId })
    .from(slotHold)
    .where(and(inArray(slotHold.date, dates), gt(slotHold.expiresAt, new Date())));
  for (const r of holds) {
    const day = (out[r.date] ??= {});
    const cell = (day[r.time] ??= { live: 0, pool: 0 });
    cell.live += 1;
    if (r.dentistId === null) cell.pool += 1;
  }
  return out;
}

/** every live (non-cancelled) booking holding one wall-clock slot, oldest first */
export async function liveAtSlot(date: string, time: string): Promise<SlotLiveRow[]> {  const rows = await db
    .select({
      id: appointment.id,
      treatmentKey: appointment.treatmentKey,
      ageGroup: appointment.ageGroup,
      dentistId: appointment.dentistId,
      createdAt: appointment.createdAt,
    })
    .from(appointment)
    .where(
      and(
        eq(appointment.date, date),
        eq(appointment.time, time),
        ne(appointment.status, "cancelled"),
      ),
    )
    .orderBy(asc(appointment.createdAt), asc(appointment.id));
  return rows.map((r) => ({
    id: r.id,
    treatmentKey: isIconKey(r.treatmentKey) ? r.treatmentKey : "checkup",
    ageGroup: isAgeGroup(r.ageGroup) ? r.ageGroup : null,
    dentistId: r.dentistId,
    createdAt: r.createdAt,
  }));
}

/* ═══════════════════════════════ slot holds ══════════════════════════════ */
/**
 * Hold-then-confirm: picking a slot writes a short reservation so a family
 * typing contact details can't lose the time to someone else. Every read
 * filters on `expires_at` — a lapsed hold stops counting by itself, no
 * background sweeper. Confirming deletes the hold then runs the normal
 * booking validation, so a lapsed hold just falls back to "is it still free?"
 * instead of failing artificially.
 */

/** how long a picked slot is reserved while the family finishes the form */
export const HOLD_MINUTES = 10;

/** active holds at one wall-clock slot — they occupy chairs like bookings */
export async function activeHoldsAtSlot(date: string, time: string): Promise<number> {
  const rows = await db
    .select({ id: slotHold.id })
    .from(slotHold)
    .where(and(eq(slotHold.date, date), eq(slotHold.time, time), gt(slotHold.expiresAt, new Date())));
  return rows.length;
}

/**
 * Reserve (date, time) for HOLD_MINUTES; returns the token the client passes
 * back to confirm, or null when an active hold already sits there. For a
 * named dentist the unique index does the work — the ON CONFLICT clause only
 * overwrites a lapsed row. A pool hold (dentistId null) has no index; the
 * caller checks chair capacity and the final booking re-checks anyway.
 */
export async function createHold(input: {
  dentistId: number | null;
  date: string;
  time: string;
  treatmentKey: string;
}): Promise<{ token: string; expiresAt: Date } | null> {
  // prune lapsed rows so the table stays small and the upsert can reuse them
  await db.delete(slotHold).where(lt(slotHold.expiresAt, new Date()));

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
  const base = {
    dentistId: input.dentistId,
    treatmentKey: input.treatmentKey,
    date: input.date,
    time: input.time,
    expiresAt,
  };
  const rows =
    input.dentistId === null
      ? await db.insert(slotHold).values({ ...base, token }).returning({ token: slotHold.token })
      : await db
          .insert(slotHold)
          .values({ ...base, token })
          .onConflictDoUpdate({
            target: [slotHold.dentistId, slotHold.date, slotHold.time],
            set: { token, expiresAt, treatmentKey: input.treatmentKey, createdAt: new Date() },
            // only a lapsed hold may be replaced — an active one wins
            setWhere: lt(slotHold.expiresAt, new Date()),
          })
          .returning({ token: slotHold.token });
  return rows.length === 0 ? null : { token, expiresAt };
}

/** drop a hold — called at confirm time and when the family picks another slot */
export async function releaseHold(token: string): Promise<void> {
  await db.delete(slotHold).where(eq(slotHold.token, token));
}

/**
 * Fixed-window throttle shared by every public action: `true` while the key
 * is under `limit` calls inside `windowSec`. One upsert — a lapsed window
 * resets the counter, a live one increments it.
 */
export async function checkRate(key: string, limit: number, windowSec: number): Promise<boolean> {
  const resetAt = new Date(Date.now() + windowSec * 1000);
  const rows = await db
    .insert(rateLimit)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`CASE WHEN ${rateLimit.resetAt} < now() THEN 1 ELSE ${rateLimit.count} + 1 END`,
        // windowSec is a server-side constant — safe to parameterize
        resetAt: sql`CASE WHEN ${rateLimit.resetAt} < now() THEN now() + ${windowSec} * interval '1 second' ELSE ${rateLimit.resetAt} END`,
      },
    })
    .returning({ count: rateLimit.count });
  return rows[0].count <= limit;
}

/**
 * Capable dentists free at one slot: on shift covering that clock time, no
 * live booking there, active. Order follows the roster (by id).
 */
export async function freeCapableAtSlot(
  date: string,
  time: string,
  treatmentKey: TreatmentKey,
  group?: AgeGroup | null,
): Promise<{ id: number; slug: string }[]> {
  const [capable, slots] = await Promise.all([
    capableDentistIds(treatmentKey, group),
    slotsForDate(date),
  ]);
  if (capable.length === 0) return [];
  const capableSet = new Set(capable);
  const seen = new Set<number>();
  const out: { id: number; slug: string }[] = [];
  for (const s of slots) {
    if (s.time !== time || s.taken || !capableSet.has(s.dentistId) || seen.has(s.dentistId)) continue;
    seen.add(s.dentistId);
    out.push({ id: s.dentistId, slug: s.dentistSlug });
  }
  // slotsForDate only emits rows inside a dentist's enabled shift, so every
  // row here is already on-shift coverage — no extra shift check needed
  return out;
}

/**
 * Assign pooled bookings while the slot is at chair capacity and a capable
 * dentist is still free. Oldest pool first; each assignment is guarded by the
 * same unique index as a normal booking, so a mid-flight race just skips.
 * Returns the refs that got a dentist.
 */
export async function settlePool(date: string, time: string): Promise<string[]> {
  const assigned: string[] = [];
  for (;;) {
    const chairs = await getChairs();
    const live = await liveAtSlot(date, time);
    if (live.length < chairs) break; // room to spare — the pool waits for staff
    const oldest = live.find((r) => r.dentistId === null);
    if (!oldest) break;
    const free = await freeCapableAtSlot(date, time, oldest.treatmentKey, oldest.ageGroup);
    if (free.length === 0) break;
    const target = free[0];
    const updated = await db
      .update(appointment)
      .set({ dentistId: target.id, updatedAt: new Date() })
      .where(and(eq(appointment.id, oldest.id), ne(appointment.status, "cancelled")))
      .returning({ ref: appointment.ref });
    if (updated.length === 0) break; // taken/cancelled mid-flight — stop, staff sees it
    assigned.push(updated[0].ref);
    const d = await dentistName(target.id);
    await db.insert(staffNotification).values({
      type: "online_booking",
      title: "จัดแพทย์ให้คิวรอแล้ว",
      body: `${updated[0].ref} ได้คุณหมอ${d.name || target.slug} (${date} ${time} น.)`,
      refCode: updated[0].ref,
    });
  }
  return assigned;
}

/* ═══════════════════════════════ appointments ═══════════════════════════ */

export interface CreateAppointmentInput {
  date: string;
  time: string;
  treatmentKey: TreatmentKey;
  /** null = pooled "any dentist" booking (see settlePool) */
  dentistId: number | null;
  childName: string;
  guardianName: string;
  phone: string;
  /** booked for the booker themselves (adult) */
  forSelf?: boolean;
  /** who it is for, as the family picked it (patient site) */
  ageGroup?: AgeGroup | null;
  source?: AppointmentSource;
  note?: string;
  price?: number | null;
  /** verified LINE userId — stored on the booking; a linked guardian wins over phone matching */
  lineUserId?: string;
  /** that account's display name, shown to the desk as "booked by" */
  lineName?: string;
  /**
   * register the family (guardian + child rows) from this booking. Staff and
   * scripts default to yes; patient-site bookings pass false — they collect a
   * nickname and phone only, and patient records are the full edition's job.
   */
  register?: boolean;
}

/**
 * make a booking reference: DK- plus six digits, retrying on collision. Refs
 * are never reused (cancelled ones included), so four digits would run out
 * after a few thousand bookings; six leaves room for decades and makes a ref
 * impractical to guess. Older four-digit refs stay valid.
 */
async function nextRef(): Promise<string> {
  for (let digits = 6; ; digits++) {
    for (let i = 0; i < 10; i++) {
      const ref = `DK-${Math.floor(10 ** (digits - 1) + Math.random() * 9 * 10 ** (digits - 1))}`;
      const hit = await db.select({ id: appointment.id }).from(appointment).where(eq(appointment.ref, ref));
      if (hit.length === 0) return ref;
    }
  }
}

/**
 * Create an appointment. The unique index (dentist, date, time) is the real
 * double-booking guard; this returns null when the slot was taken mid-flight
 * so the caller can show "slot just filled".
 */
export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentDTO | null> {
  const ref = await nextRef();

  // match the family by phone — a first-time caller is registered so the
  // booking links to a real guardian/child, not just free text. A LINE-linked
  // account wins over the phone match: every booking stays on one guardian
  // even when the family types a different contact number.
  const digits = input.phone.replace(/\D/g, "");
  let guardianId: number | null = null;
  let childId: number | null = null;

  if (input.register !== false) {
    const fam = await findFamilyByPhone(digits);
    const lineGuardian = input.lineUserId ? await findGuardianByLineId(input.lineUserId) : null;
    guardianId = lineGuardian?.id ?? fam[0]?.id ?? null;

    if (!guardianId) {
      guardianId = await upsertGuardian({ name: input.guardianName, phone: digits });
    }

    if (input.childName && !input.forSelf) {
      const name = input.childName.trim();
      const kids = await db.select().from(child).where(eq(child.guardianId, guardianId));
      childId = kids.find((c) => c.name === name)?.id ?? null;
      if (!childId) {
        await addChildToGuardian(guardianId, name);
        const again = await db.select().from(child).where(eq(child.guardianId, guardianId));
        childId = again.find((c) => c.name === name)?.id ?? null;
      }
    }
  }

  const inserted = await db
    .insert(appointment)
    .values({
      ref,
      childId,
      childName: input.childName,
      guardianId,
      guardianName: input.guardianName,
      phone: digits,
      dentistId: input.dentistId,
      treatmentKey: input.treatmentKey,
      date: input.date,
      time: input.time,
      durationMin: 30,
      source: input.source ?? "online",
      status: "confirmed",
      note: input.note ?? "",
      price: input.price ?? null,
      forSelf: input.forSelf ?? false,
      ageGroup: input.ageGroup ?? null,
      lineUserId: input.lineUserId ?? null,
      lineName: input.lineName ?? "",
    })
    // the arbiter matches the partial unique index (status <> 'cancelled'):
    // a live booking keeps its slot exclusive; cancelled ones free it
    .onConflictDoNothing({
      target: [appointment.dentistId, appointment.date, appointment.time],
      where: ne(appointment.status, "cancelled"),
    })
    .returning();

  const row = inserted[0];
  if (!row) return null; // slot taken mid-flight

  // pooled rows have no dentist yet — the slug stays empty until settlePool
  // or the staff console assigns one
  const d = row.dentistId === null ? { slug: "", name: "" } : await dentistName(row.dentistId);
  await db.insert(staffNotification).values({
    type: "online_booking",
    title: "การจองใหม่ออนไลน์",
    body:
      `${row.childName} นัดหมาย ${row.date} เวลา ${row.time} น. (${row.ref})` +
      (row.dentistId === null ? " — รอจัดแพทย์" : ""),
    refCode: row.ref,
  });

  return toAppointmentDTO(row, d.slug, d.name);
}

function toAppointmentDTO(
  row: typeof appointment.$inferSelect,
  dentistSlug: string,
  dentistName: string,
): AppointmentDTO {
  return {
    id: row.id,
    ref: row.ref,
    date: row.date,
    time: row.time,
    durationMin: row.durationMin,
    childId: row.childId,
    childName: row.childName,
    guardianId: row.guardianId,
    guardianName: row.guardianName,
    phone: row.phone,
    dentistId: row.dentistId,
    dentistSlug,
    dentistName,
    treatmentKey: asIconKey(row.treatmentKey),
    source: row.source as AppointmentSource,
    status: row.status as AppointmentStatus,
    checkedInAt: row.checkedInAt,
    note: row.note,
    price: row.price,
    forSelf: row.forSelf,
    ageGroup: isAgeGroup(row.ageGroup) ? row.ageGroup : null,
    lineName: row.lineName,
    hasLine: !!row.lineUserId,
  };
}

async function dentistName(dentistId: number): Promise<{ slug: string; name: string }> {
  const rows = await db
    .select({ slug: dentist.slug, name: dentistText.name })
    .from(dentist)
    .leftJoin(dentistText, and(eq(dentistText.dentistId, dentist.id), eq(dentistText.lang, "th")))
    .where(eq(dentist.id, dentistId));
  const r = rows[0];
  return { slug: r?.slug ?? "", name: r?.name ?? "" };
}

export async function listAppointmentsBetween(start: string, end: string): Promise<AppointmentDTO[]> {
  const rows = await db
    .select({ a: appointment, slug: dentist.slug, dname: dentistText.name })
    .from(appointment)
    .leftJoin(dentist, eq(dentist.id, appointment.dentistId))
    .leftJoin(dentistText, and(eq(dentistText.dentistId, dentist.id), eq(dentistText.lang, "th")))
    .where(and(gte(appointment.date, start), lte(appointment.date, end)))
    .orderBy(asc(appointment.date), asc(appointment.time));

  return rows.map((r) =>
    toAppointmentDTO(
      r.a,
      r.slug ?? "",
      r.dname ?? "",
    ),
  );
}

export async function listAppointmentsByPhone(phone: string): Promise<AppointmentDTO[]> {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  return listAppointmentsBetween("1970-01-01", "9999-12-31").then((all) =>
    all.filter((a) => a.phone.replace(/\D/g, "") === digits),
  );
}

export interface AppointmentUpdate {
  status?: AppointmentStatus;
  /** set by the queue flow when the family checks in */
  checkedInAt?: string | null;
  date?: string;
  time?: string;
  /** null unassigns back to the pool; a number assigns (guarded by callers) */
  dentistId?: number | null;
  note?: string;
  price?: number | null;
  childName?: string;
  guardianName?: string;
  phone?: string;
}

export async function updateAppointment(id: number, patch: AppointmentUpdate): Promise<void> {
  await db
    .update(appointment)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(appointment.id, id));
}

export async function deleteAppointment(id: number): Promise<void> {
  await db.delete(appointment).where(eq(appointment.id, id));
}

/* ═══════════════════════════════ patients ═══════════════════════════════ */

function toGuardianDTO(
  g: typeof guardian.$inferSelect,
  cs: (typeof child.$inferSelect)[],
): GuardianDTO {
  return {
    id: g.id,
    name: g.name,
    fullName: g.fullName,
    relation: g.relation,
    phone: g.phone,
    lineUserId: g.lineUserId,
    lineContact: g.lineContact,
    address: g.address,
    children: cs
      .filter((c) => c.guardianId === g.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        fullName: c.fullName,
        nickname: c.nickname,
        birthdate: c.birthdate,
        age: c.age,
        allergies: c.allergies,
        notes: c.notes,
        conditions: c.conditions,
        medications: c.medications,
        hn: c.hn,
        gender: c.gender,
        bloodType: c.bloodType,
        idCard: c.idCard,
        tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        recallMonths: c.recallMonths,
        coverage: c.coverage,
      })),
    registeredAt: g.createdAt.toISOString().slice(0, 10),
  };
}

export async function findFamilyByPhone(phone: string): Promise<GuardianDTO[]> {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];

  const gs = await db.select().from(guardian).where(eq(guardian.phone, digits));
  if (gs.length === 0) return [];

  const cs = await db
    .select()
    .from(child)
    .where(inArray(child.guardianId, gs.map((g) => g.id)));

  return gs.map((g) => toGuardianDTO(g, cs));
}

/** the LINE side of the phone lookup — one verified userId, one guardian */
export async function findGuardianByLineId(lineUserId: string) {
  const rows = await db.select().from(guardian).where(eq(guardian.lineUserId, lineUserId));
  return rows[0] ?? null;
}

/**
 * Everything one LINE account booked: bookings stamped with its userId, plus
 * older ones that reached it through a LINE-linked guardian row.
 */
export async function listAppointmentsForLine(lineUserId: string): Promise<AppointmentDTO[]> {
  const g = await findGuardianByLineId(lineUserId);
  const all = await listAppointmentsBetween("1970-01-01", "9999-12-31");
  const mine = new Set(
    (
      await db
        .select({ id: appointment.id })
        .from(appointment)
        .where(
          g
            ? or(eq(appointment.lineUserId, lineUserId), eq(appointment.guardianId, g.id))
            : eq(appointment.lineUserId, lineUserId),
        )
    ).map((r) => r.id),
  );
  return all.filter((a) => mine.has(a.id)).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

/** where a booking's LINE messages go: its own account, else its linked guardian's */
export async function lineTargetForAppointment(id: number): Promise<string | null> {
  const rows = await db
    .select({ own: appointment.lineUserId, viaGuardian: guardian.lineUserId })
    .from(appointment)
    .leftJoin(guardian, eq(appointment.guardianId, guardian.id))
    .where(eq(appointment.id, id));
  return rows[0]?.own ?? rows[0]?.viaGuardian ?? null;
}

export async function listPatients(): Promise<GuardianDTO[]> {
  const [gs, cs] = await Promise.all([
    db.select().from(guardian).orderBy(asc(guardian.id)),
    db.select().from(child),
  ]);
  return gs.map((g) => toGuardianDTO(g, cs));
}

/** the full patient form — also re-exported under its old names */
export type CreatePatientInput = PatientUpsertInput;
export type ChildInput = PatientChildInput;

/**
 * Field-patch rule for patient writes: an absent key means "the caller didn't
 * send it" (the booking flow only ever passes name+phone — it must NOT erase
 * the record the desk filled in), while an empty string IS written (the desk
 * cleared the field on purpose).
 */
function guardianPatch(input: Partial<PatientUpsertInput>): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.fullName !== undefined) set.fullName = input.fullName;
  if (input.relation !== undefined) set.relation = input.relation;
  if (input.address !== undefined) set.address = input.address;
  // the typed LINE id goes to line_contact — line_user_id stays owned by the
  // verified LIFF link flow
  if (input.lineId !== undefined) set.lineContact = input.lineId;
  return set;
}

/**
 * Reconcile a guardian's children with the submitted list: rows carrying their
 * DB id (or matching by name) are updated, the rest are inserted, and rows
 * the form dropped are deleted. Only runs when the caller actually sent a
 * `children` list — booking writes pass none and leave records alone.
 */
async function syncChildren(guardianId: number, children: PatientChildInput[]): Promise<void> {
  const existing = await db.select().from(child).where(eq(child.guardianId, guardianId));
  const keep = new Set<number>();
  for (const c of children) {
    const clean = c.name.trim();
    if (!clean) continue;
    const values = {
      guardianId,
      name: clean,
      fullName: c.fullName ?? "",
      nickname: c.nickname || null,
      birthdate: c.birthdate || null,
      age: c.age ?? null,
      gender: c.gender || null,
      hn: c.hn || null,
      bloodType: c.bloodType ?? "",
      conditions: c.conditions ?? "",
      medications: c.medications ?? "",
      allergies: c.allergies ?? "",
      notes: c.notes ?? "",
      ...(c.idCard !== undefined ? { idCard: c.idCard.replace(/\D/g, "").slice(0, 13) } : {}),
      ...(c.tags !== undefined ? { tags: c.tags.map((t) => t.trim()).filter(Boolean).slice(0, 12) } : {}),
      ...(c.recallMonths !== undefined ? { recallMonths: Math.max(0, Math.min(24, Math.round(c.recallMonths))) } : {}),
      ...(c.coverage !== undefined ? { coverage: ["cash", "sso", "nhso", "gov", "insurance"].includes(c.coverage) ? c.coverage : "cash" } : {}),
      updatedAt: new Date(),
    };
    const hit =
      (typeof c.id === "number" ? existing.find((x) => x.id === c.id) : undefined) ??
      existing.find((x) => x.name === clean);
    if (hit) {
      keep.add(hit.id);
      await db.update(child).set(values).where(eq(child.id, hit.id));
    } else {
      const [row] = await db.insert(child).values(values).returning({ id: child.id });
      keep.add(row.id);
    }
  }
  for (const x of existing) {
    if (!keep.has(x.id)) await db.delete(child).where(eq(child.id, x.id));
  }
}

/** upsert on phone: a returning caller updates the name instead of doubling */
export async function upsertGuardian(input: PatientUpsertInput): Promise<number> {
  const digits = input.phone.replace(/\D/g, "");
  const existing = await db.select().from(guardian).where(eq(guardian.phone, digits));
  let guardianId: number;

  if (existing.length > 0) {
    guardianId = existing[0].id;
    await db.update(guardian).set(guardianPatch(input)).where(eq(guardian.id, guardianId));
  } else {
    const [row] = await db
      .insert(guardian)
      .values({
        name: input.name,
        phone: digits,
        fullName: input.fullName ?? "",
        relation: input.relation ?? "",
        lineContact: input.lineId ?? "",
        address: input.address ?? "",
      })
      .returning({ id: guardian.id });
    guardianId = row.id;
  }

  if (input.children) await syncChildren(guardianId, input.children);
  return guardianId;
}

export async function updatePatient(
  id: number,
  patch: Partial<PatientUpsertInput>,
): Promise<void> {
  if (patch.phone !== undefined) {
    await db
      .update(guardian)
      .set({ phone: patch.phone.replace(/\D/g, "") })
      .where(eq(guardian.id, id));
  }
  await db.update(guardian).set(guardianPatch(patch)).where(eq(guardian.id, id));
  if (patch.children) await syncChildren(id, patch.children);
}

export async function addChildToGuardian(
  guardianId: number,
  input: string | PatientChildInput,
): Promise<void> {
  const c: PatientChildInput = typeof input === "string" ? { name: input } : input;
  const clean = c.name.trim();
  if (!clean) return;
  const dup = await db
    .select({ id: child.id })
    .from(child)
    .where(and(eq(child.guardianId, guardianId), eq(child.name, clean)));
  if (dup.length === 0) {
    await db.insert(child).values({
      guardianId,
      name: clean,
      fullName: c.fullName ?? "",
      nickname: c.nickname || null,
      birthdate: c.birthdate || null,
      age: c.age ?? null,
      gender: c.gender || null,
      hn: c.hn || null,
      bloodType: c.bloodType ?? "",
      conditions: c.conditions ?? "",
      medications: c.medications ?? "",
      allergies: c.allergies ?? "",
      notes: c.notes ?? "",
    });
  }
}

/* ═══════════════════════════════ waitlist ═══════════════════════════════ */

/**
 * Today's walk-ins (clinic time). A walk-in only ever means "here today" —
 * its arrivedAt is a bare HH:MM — so earlier days' rows must not resurface
 * on the desk board or the parents' queue page.
 */
export async function listWaitlist(): Promise<WaitlistDTO[]> {
  const rows = await db
    .select({ w: waitlistEntry, slug: dentist.slug })
    .from(waitlistEntry)
    .leftJoin(dentist, eq(dentist.id, waitlistEntry.dentistId))
    .where(sql`(${waitlistEntry.createdAt} at time zone 'Asia/Bangkok')::date = ${todayISO()}::date`)
    .orderBy(asc(waitlistEntry.arrivedAt));

  return rows.map((r) => ({
    id: r.w.id,
    childName: r.w.childName,
    guardianPhone: r.w.guardianPhone,
    treatmentKey: asIconKey(r.w.treatmentKey),
    dentistId: r.w.dentistId,
    dentistSlug: r.slug ?? null,
    arrivedAt: r.w.arrivedAt,
    status: r.w.status as WaitlistDTO["status"],
    note: r.w.note,
  }));
}

/** the clinic's wall clock as HH:MM (Asia/Bangkok) — check-in/arrival stamps */
export function clinicNowHHMM(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export async function addWaitlist(input: {
  childName: string;
  guardianPhone?: string;
  treatmentKey: TreatmentKey;
  dentistId?: number | null;
  note?: string;
}): Promise<void> {
  const hhmm = clinicNowHHMM();
  await db.insert(waitlistEntry).values({
    childName: input.childName,
    guardianPhone: (input.guardianPhone ?? "").replace(/\D/g, ""),
    treatmentKey: input.treatmentKey,
    dentistId: input.dentistId ?? null,
    arrivedAt: hhmm,
    status: "waiting",
    note: input.note ?? "",
  });
}

export async function updateWaitlistStatus(
  id: number,
  status: "waiting" | "in_chair" | "done",
  dentistId?: number | null,
): Promise<void> {
  await db
    .update(waitlistEntry)
    // undefined = leave the assignment alone; null = deliberately un-assign
    .set({ status, ...(dentistId !== undefined ? { dentistId } : {}), updatedAt: new Date() })
    .where(eq(waitlistEntry.id, id));
}

export async function removeWaitlist(id: number): Promise<void> {
  await db.delete(waitlistEntry).where(eq(waitlistEntry.id, id));
}

/* ═══════════════════════ visit records (room page) ══════════════════════ */

/**
 * Records attached to a day: everything linked to an appointment on `date`,
 * plus every record linked to a walk-in (the waitlist only ever holds
 * "today" — it has no date column).
 */
export async function listVisitRecordsForDate(date: string): Promise<VisitRecordDTO[]> {
  const rows = await db
    .select({ v: visitRecord, dslug: dentist.slug })
    .from(visitRecord)
    .leftJoin(appointment, eq(appointment.id, visitRecord.appointmentId))
    .leftJoin(dentist, eq(dentist.id, visitRecord.dentistId))
    .where(or(eq(appointment.date, date), isNotNull(visitRecord.waitlistId)));

  return rows.map((r) => ({
    id: r.v.id,
    appointmentId: r.v.appointmentId,
    waitlistId: r.v.waitlistId,
    dentistId: r.v.dentistId,
    dentistSlug: r.dslug,
    treatments: Array.isArray(r.v.treatments) ? (r.v.treatments as string[]) : [],
    detail: r.v.detail,
    price: r.v.price,
    items: Array.isArray(r.v.items) ? (r.v.items as VisitItem[]) : [],
    updatedAt: r.v.updatedAt.toISOString(),
  }));
}

/**
 * Write (or overwrite) the dentist's record of one visit — what was done,
 * the note, the charge. Exactly one of appointmentId/waitlistId must be set;
 * the partial unique indexes on visit_record are the real guard, the lookup
 * here just makes a repeat save an update instead of a 500.
 */
export async function upsertVisitRecord(input: {
  appointmentId?: number | null;
  waitlistId?: number | null;
  dentistId?: number | null;
  treatments: string[];
  detail: string;
  price?: number | null;
  items?: VisitItem[];
}): Promise<void> {
  const appointmentId = input.appointmentId ?? null;
  const waitlistId = input.waitlistId ?? null;
  if ((appointmentId === null) === (waitlistId === null)) return; // need exactly one

  // lines, when given, are the truth — the keys and the total follow them
  const items = (input.items ?? [])
    .filter((i) => i && typeof i.key === "string" && i.key)
    .map((i) => ({
      key: i.key,
      teeth: String(i.teeth ?? "").slice(0, 60),
      qty: Math.max(1, Math.round(Number(i.qty) || 1)),
      price: Math.max(0, Math.round(Number(i.price) || 0)),
    }));
  const values = {
    appointmentId,
    waitlistId,
    dentistId: input.dentistId ?? null,
    treatments: items.length ? [...new Set(items.map((i) => i.key))] : input.treatments,
    detail: input.detail,
    price: items.length ? items.reduce((s, i) => s + i.qty * i.price, 0) : (input.price ?? null),
    items,
    updatedAt: new Date(),
  };

  const where =
    appointmentId !== null
      ? eq(visitRecord.appointmentId, appointmentId)
      : eq(visitRecord.waitlistId, waitlistId!);
  const existing = await db.select({ id: visitRecord.id }).from(visitRecord).where(where).limit(1);
  if (existing[0]) {
    await db.update(visitRecord).set(values).where(eq(visitRecord.id, existing[0].id));
  } else {
    await db.insert(visitRecord).values(values);
  }
}

/* ═══════════════════════ queue board (public read) ══════════════════════ */

/**
 * One row of the live queue: a checked-in booking or a walk-in, ordered by
 * when the patient arrived. This is the shape /api/queue and the queue-check
 * site consume — ref codes and display names only, never phone numbers.
 */
export interface QueueItemDTO {
  /** "booking" = appointment row, "walkin" = waitlist row */
  kind: "booking" | "walkin";
  /** "DK-4821" for bookings, "W-12" for walk-ins */
  ref: string;
  name: string;
  /** scheduled = booked, not here yet; waiting = in line; serving = in the chair */
  state: "scheduled" | "waiting" | "serving" | "done" | "no_show";
  /** check-in / walk-in arrival (HH:MM) — the live-lane sort key */
  at: string;
  /** the booked slot (bookings only) */
  time: string | null;
  dentistSlug: string | null;
  dentistName: string;
}

export interface QueueDayDTO {
  /** active dentists — the queue site's doctor filter options */
  dentists: { slug: string; name: string }[];
  /** confirmed bookings, slot order */
  scheduled: QueueItemDTO[];
  /** checked-in bookings + waiting walk-ins, arrival order */
  waiting: QueueItemDTO[];
  /** in the chair now, arrival order */
  serving: QueueItemDTO[];
  /** finished / no-show bookings, slot order */
  done: QueueItemDTO[];
}

const byAt = (a: QueueItemDTO, b: QueueItemDTO) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const byTime = (a: QueueItemDTO, b: QueueItemDTO) =>
  (a.time ?? "") < (b.time ?? "") ? -1 : (a.time ?? "") > (b.time ?? "") ? 1 : 0;

/**
 * The full public day view: who's booked, who's waiting, who's in the chair,
 * who's done. Walk-ins only exist "today" — the waitlist has no date.
 * /api/queue and the queue-check site consume this — ref codes and display
 * names only, never phone numbers.
 */
export async function queueDay(date: string): Promise<QueueDayDTO> {
  const isToday = date === todayISO();
  const [appts, walks, docs] = await Promise.all([
    db
      .select({ a: appointment, dslug: dentist.slug, dname: dentistText.name })
      .from(appointment)
      .leftJoin(dentist, eq(dentist.id, appointment.dentistId))
      .leftJoin(
        dentistText,
        and(eq(dentistText.dentistId, dentist.id), eq(dentistText.lang, "th")),
      )
      .where(and(eq(appointment.date, date), ne(appointment.status, "cancelled"))),
    isToday
      ? db
          .select({ w: waitlistEntry, dslug: dentist.slug, dname: dentistText.name })
          .from(waitlistEntry)
          .leftJoin(dentist, eq(dentist.id, waitlistEntry.dentistId))
          .leftJoin(
            dentistText,
            and(eq(dentistText.dentistId, dentist.id), eq(dentistText.lang, "th")),
          )
          // only today's walk-ins (clinic time) — older rows are other days' queues
          .where(sql`(${waitlistEntry.createdAt} at time zone 'Asia/Bangkok')::date = ${date}::date`)
      : Promise.resolve([]),
    db
      .select({ slug: dentist.slug, name: dentistText.name })
      .from(dentist)
      .leftJoin(
        dentistText,
        and(eq(dentistText.dentistId, dentist.id), eq(dentistText.lang, "th")),
      )
      .where(eq(dentist.isActive, true)),
  ]);

  const booked: QueueItemDTO[] = appts.map((r) => ({
    kind: "booking",
    ref: r.a.ref,
    name: r.a.childName,
    state:
      r.a.status === "confirmed"
        ? "scheduled"
        : r.a.status === "arrived"
          ? "waiting"
          : r.a.status === "in_chair"
            ? "serving"
            : r.a.status === "no_show"
              ? "no_show"
              : "done",
    at: r.a.checkedInAt ?? r.a.time,
    time: r.a.time,
    dentistSlug: r.dslug,
    dentistName: r.dname ?? "",
  }));
  const walked: QueueItemDTO[] = walks.map((r) => ({
    kind: "walkin",
    ref: `W-${r.w.id}`,
    name: r.w.childName,
    state:
      r.w.status === "in_chair" ? "serving" : r.w.status === "done" ? "done" : "waiting",
    at: r.w.arrivedAt,
    time: null,
    dentistSlug: r.dslug,
    dentistName: r.dname ?? "",
  }));

  return {
    dentists: docs.map((d) => ({ slug: d.slug, name: d.name ?? d.slug })),
    scheduled: booked.filter((i) => i.state === "scheduled").sort(byTime),
    waiting: [...booked, ...walked].filter((i) => i.state === "waiting").sort(byAt),
    serving: [...booked, ...walked].filter((i) => i.state === "serving").sort(byAt),
    done: [...booked, ...walked]
      .filter((i) => i.state === "done" || i.state === "no_show")
      .sort(byTime),
  };
}

export interface QueueLookupDTO {
  found: boolean;
  ref?: string;
  name?: string;
  /** scheduled = booked but not checked in yet */
  state?: "scheduled" | "waiting" | "serving" | "done" | "cancelled" | "no_show";
  /** 1-based position among the waiting list */
  position?: number;
  ahead?: number;
  time?: string;
}

/**
 * "Where am I in the queue?" — by booking ref, on one day (the public route
 * only ever asks about today). Positions count the merged waiting list above.
 * No phone lookup: a phone number is not proof of anything.
 */
export async function queueStatus(input: { date: string; ref?: string }): Promise<QueueLookupDTO> {
  const ref = (input.ref ?? "").trim().toUpperCase();
  if (!ref) return { found: false };

  if (ref.startsWith("W-")) {
    // walk-ins only exist on the day's board — never look one up by bare id
    const day = await queueDay(input.date);
    const w = [...day.waiting, ...day.serving, ...day.done].find((x) => x.ref === ref);
    if (!w) return { found: false };
    const base = { found: true as const, ref, name: w.name };
    if (w.state === "done") return { ...base, state: "done" };
    if (w.state === "serving") return { ...base, state: "serving" };
    const position = day.waiting.findIndex((x) => x.ref === ref) + 1;
    return { ...base, state: "waiting", position, ahead: Math.max(0, position - 1) };
  }

  const rows = await db.select().from(appointment).where(eq(appointment.date, input.date));
  const target = rows.find((a) => a.ref.toUpperCase() === ref);
  if (!target) return { found: false };

  const base = { found: true as const, ref: target.ref, name: target.childName, time: target.time };
  switch (target.status) {
    case "cancelled":
      return { ...base, state: "cancelled" };
    case "no_show":
      return { ...base, state: "no_show" };
    case "completed":
      return { ...base, state: "done" };
    case "in_chair":
      return { ...base, state: "serving" };
    case "arrived": {
      const { waiting } = await queueDay(input.date);
      const position = waiting.findIndex((w) => w.ref === target.ref) + 1;
      return { ...base, state: "waiting", position, ahead: Math.max(0, position - 1) };
    }
    default:
      return { ...base, state: "scheduled" };
  }
}

/* ═════════════════════════════ notifications ════════════════════════════ */

export async function listNotifications(): Promise<NotificationDTO[]> {
  const rows = await db
    .select()
    .from(staffNotification)
    .orderBy(desc(staffNotification.createdAt))
    .limit(50);
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    refCode: n.refCode,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationsRead(): Promise<void> {
  await db.update(staffNotification).set({ isRead: true }).where(eq(staffNotification.isRead, false));
}

/* ═══════════════════════════ dentist mutations ══════════════════════════ */

export interface DentistUpdate {
  years?: number;
  tint?: string;
  isActive?: boolean;
  photoSmall?: string;
  photoLarge?: string;
  text?: Partial<Record<"th" | "en", Partial<DentistTextDTO>>>;
  treats?: IconKey[];
  /** per treatment, who they see; anything missing is "both" */
  treatAges?: Partial<Record<string, TreatAges>>;
  shifts?: { weekday: number; enabled: boolean; start: string; end: string }[];
}

/**
 * The dentist_treat rows for a treatment scope: every treatment they take,
 * with who they see for it. Routine visits (everyone takes them) only get a
 * row when they're limited to kids or adults.
 */
function treatRows(dentistId: number, treats: IconKey[], treatAges: Partial<Record<string, TreatAges>> = {}) {
  const ages = (k: string): TreatAges => (isTreatAges(treatAges[k]) ? treatAges[k]! : "both");
  const keys = new Set<string>(treats);
  for (const k of GENERAL_TREATS) if (ages(k) !== "both") keys.add(k);
  return [...keys].map((k) => ({ dentistId, treatmentKey: k, ages: ages(k) }));
}

export async function updateDentist(slug: string, patch: DentistUpdate): Promise<void> {
  const rows = await db.select({ id: dentist.id }).from(dentist).where(eq(dentist.slug, slug));
  const id = rows[0]?.id;
  if (!id) throw new Error(`unknown dentist: ${slug}`);

  const { text, treats, treatAges, shifts, ...plain } = patch;

  if (Object.keys(plain).length > 0) {
    await db
      .update(dentist)
      .set({ ...plain, updatedAt: new Date() })
      .where(eq(dentist.id, id));
  }

  if (text?.th) {
    await db
      .update(dentistText)
      .set(text.th)
      .where(and(eq(dentistText.dentistId, id), eq(dentistText.lang, "th")));
  }
  if (text?.en) {
    await db
      .update(dentistText)
      .set(text.en)
      .where(and(eq(dentistText.dentistId, id), eq(dentistText.lang, "en")));
  }

  if (treats) {
    await db.delete(dentistTreat).where(eq(dentistTreat.dentistId, id));
    for (const r of treatRows(id, treats, treatAges)) {
      await db.insert(dentistTreat).values(r).onConflictDoNothing();
    }
  }

  if (shifts) {
    for (const s of shifts) {
      await db
        .insert(dentistShift)
        .values({ dentistId: id, ...s })
        .onConflictDoUpdate({
          target: [dentistShift.dentistId, dentistShift.weekday],
          set: { enabled: s.enabled, start: s.start, end: s.end },
        });
    }
  }
}

export interface NewDentistInput {
  slug: string;
  years: number;
  tint: string;
  text: Record<"th" | "en", DentistTextDTO>;
  treats: IconKey[];
  treatAges?: Partial<Record<string, TreatAges>>;
  shifts: { weekday: number; enabled: boolean; start: string; end: string }[];
  photoSmall?: string;
  photoLarge?: string;
}

export async function createDentist(input: NewDentistInput): Promise<void> {
  const sorts = await db.select({ s: dentist.sort }).from(dentist);
  const sort = sorts.reduce((m, r) => Math.max(m, r.s), -1) + 1;
  const [row] = await db
    .insert(dentist)
    .values({
      slug: input.slug,
      years: input.years,
      tint: input.tint,
      face: {},
      photoSmall: input.photoSmall ?? "",
      photoLarge: input.photoLarge ?? "",
      isActive: true,
      sort,
    })
    .returning({ id: dentist.id });

  for (const lang of ["th", "en"] as const) {
    await db.insert(dentistText).values({ dentistId: row.id, lang, ...input.text[lang] });
  }
  for (const r of treatRows(row.id, input.treats, input.treatAges)) {
    await db.insert(dentistTreat).values(r).onConflictDoNothing();
  }
  for (const s of input.shifts) {
    await db.insert(dentistShift).values({ dentistId: row.id, ...s }).onConflictDoNothing();
  }
}

/* ═══════════════════════════ price / schedule mutations ═════════════════ */

export async function updateTreatmentPrice(key: IconKey, price: number | null): Promise<void> {
  await db
    .update(treatment)
    .set({ price, updatedAt: new Date() })
    .where(eq(treatment.key, key));
}

export async function updateClinicDay(
  day: string,
  patch: { isOpen?: boolean; start?: string; end?: string },
): Promise<void> {
  await db.update(clinicDay).set(patch).where(eq(clinicDay.day, day));
}

export async function addHolidayRange(start: string, end: string, name: string): Promise<void> {
  const s = start <= end ? start : end;
  const e = start <= end ? end : start;
  await db.insert(holiday).values({ start: s, end: e, name });
}

export async function removeHoliday(id: number): Promise<void> {
  await db.delete(holiday).where(eq(holiday.id, id));
}

/* ═══════════════════════════ misc helpers ═══════════════════════════════ */

/** count of unread staff notifications — the sidebar badge */
export async function unreadNotificationCount(): Promise<number> {
  return db.$count(staffNotification, eq(staffNotification.isRead, false));
}
