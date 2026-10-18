"use server";

import "server-only";
import type { TreatmentKey } from "@/lib/treatments";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type { IconKey } from "@/data/icons";
import { db } from "@/db/client";
import { staffNotification } from "@/db/schema";
import {
  addHolidayRange,
  addChildToGuardian,
  addWaitlist,
  createAppointment,
  createDentist,
  deleteAppointment,
  listAppointmentsBetween,
  markNotificationsRead,
  priceMap,
  removeHoliday,
  removeWaitlist,
  updateAppointment,
  updateClinicDay,
  updateClinicInfo,
  updateDentist,
  updatePatient,
  updateTreatmentPrice,
  updateWaitlistStatus,
  upsertGuardian,
  clinicNowHHMM,
  type AppointmentUpdate,
  type ChildInput,
  type CreatePatientInput,
  type DentistUpdate,
  type NewDentistInput,
} from "@/server/queries";
import type { WaitlistDTO } from "@/server/queries";
import { thaiDate, todayISO } from "@/lib/dates";
import { isAgeGroup, type AgeGroup } from "@/lib/ageGroup";
import type { Perm } from "@/lib/roles";
import type { VisitRecordInput } from "@/lib/staffTypes";

export type { VisitRecordInput } from "@/lib/staffTypes";

/**
 * Server Actions — the mutation API for both UIs.
 *
 * Every write the patient site or the staff console performs goes through
 * here. Actions revalidate the pages whose data they change, so both UIs
 * refresh without a redeploy or a manual reload.
 *
 * NOTE ON AUTH: every `staff*` action checks the staff cookie first
 * (`requireStaff` in staffAuth.ts) — server actions are plain POST endpoints,
 * so the page gate alone would leave them callable. Patient-facing actions
 * stay public by design (booking works without an account) but are throttled
 * per IP via `limited()` below.
 */

/** true = over the limit; the caller should refuse the action */
async function limited(scope: string, limit: number, windowSec: number): Promise<boolean> {
  let ip: string;
  try {
    const h = await headers();
    ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  } catch {
    return false; // no request scope — local script, never throttled
  }
  if (!ip) return false;
  const { checkRate } = await import("@/server/queries");
  return !(await checkRate(`${scope}:${ip}`, limit, windowSec));
}

/**
 * gate every staff* action — see the NOTE ON AUTH above. Full-edition
 * actions also name what they need (`perm`): the signed-in person's role
 * must allow it. With no staff accounts set up, everyone may (as before).
 */
async function guard(perm?: Perm) {
  const { requireStaff } = await import("@/server/staffAuth");
  await requireStaff();
  if (perm) {
    const { requirePerm } = await import("@/server/users");
    await requirePerm(perm);
  }
}

/** remember who did something that matters (payments, cancellations, settings…) */
async function logAction(action: string, detail = "") {
  const { audit } = await import("@/server/users");
  await audit(action, detail);
}

/* ── paths whose data these actions touch ────────────────────────────────── */

const STAFF_PATHS = [
  "/staff",
  "/staff/appointments",
  "/staff/dentists",
  "/staff/patients",
  "/staff/services",
  "/staff/settings",
  "/staff/notifications",
];

/**
 * Revalidation only works inside a Next.js request context. That is always
 * true for the real app (actions run over HTTP); scripts that call these same
 * functions directly skip it silently.
 */
function revalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // no request scope (direct script call) — pages will still read fresh
    // data because every DB-backed route renders dynamically
  }
}

function revalidatePatientSite() {
  revalidate("/");
  revalidate("/book");
  revalidate("/bookings");
  revalidate("/dentists");
  revalidate("/services");
  revalidate("/notifications");
}

function revalidateStaff() {
  for (const p of STAFF_PATHS) revalidate(p);
}

function revalidateAll() {
  revalidatePatientSite();
  revalidateStaff();
}

/** a cancellation the patient made — staff hear about it immediately */
async function dbInsertCancellationNotice(ref: string, childName: string, date: string, time: string) {
  await db.insert(staffNotification).values({
    type: "cancellation",
    title: "ผู้ปกครองยกเลิกนัดหมาย",
    body: `${childName} ยกเลิกนัด ${date} เวลา ${time} น. (${ref})`,
    refCode: ref,
  });
}

/* ═══════════════════════════ booking (patient site) ═════════════════════ */

export interface BookResult {
  ok: boolean;
  /** set when ok — the created appointment, for the confirmation slip */
  ref?: string;
  /** set when !ok — the reason to show the parent */
  error?: "slot_taken" | "invalid" | "line";
}

/**
 * Slot-only validation shared by `holdSlot` and `bookAppointment`. "ok" means
 * the slot may be held or booked right now: in range, on a shift a capable
 * dentist works, and either that dentist is free (named) or the chairs aren't
 * full (pool). Active holds count as taken/at-capacity everywhere.
 */
async function slotVerdict(
  date: string,
  time: string,
  treatmentKey: TreatmentKey,
  dentistId: number | null,
  /** who it's for — only dentists who see that group count */
  group: AgeGroup | null = null,
): Promise<"ok" | "invalid" | "slot_taken"> {
  const { todayISO, nowMinutes, minutesOf } = await import("@/lib/dates");
  const today = todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return "invalid";
  if (!/^\d{2}:\d{2}$/.test(time)) return "invalid";
  // never bookable: a past date, or today with under an hour to spare —
  // the same lead the calendar enforces
  if (date === today && minutesOf(time) < nowMinutes() + 60) return "invalid";

  const { getChairs, liveAtSlot, activeHoldsAtSlot, slotsForDate, capableDentistIds } =
    await import("@/server/queries");

  // "any dentist": the booking joins the pool (dentist_id NULL) while the
  // slot holds fewer live rows — bookings + active holds — than there are
  // chairs. Pooling into a slot no capable dentist covers would wait forever.
  if (dentistId === null) {
    const [chairs, live, holds, rows, capable] = await Promise.all([
      getChairs(),
      liveAtSlot(date, time),
      activeHoldsAtSlot(date, time),
      slotsForDate(date),
      capableDentistIds(treatmentKey, group),
    ]);
    if (live.length + holds >= chairs) return "slot_taken";
    const capableSet = new Set(capable);
    const covered = rows.some((r) => r.time === time && capableSet.has(r.dentistId));
    if (!covered) return "slot_taken";
    return "ok";
  }

  // a named dentist must take this treatment AND be on shift at that slot —
  // slotsForDate rows only exist inside enabled shifts on open days, and an
  // active hold marks the slot taken exactly like a booking
  const [capable, rows] = await Promise.all([
    capableDentistIds(treatmentKey, group),
    slotsForDate(date),
  ]);
  if (!capable.includes(dentistId)) return "invalid";
  const slot = rows.find((r) => r.dentistId === dentistId && r.time === time);
  if (!slot || slot.taken) return "slot_taken";
  return "ok";
}

/**
 * Hold-then-confirm, step one: reserve the picked slot for HOLD_MINUTES so it
 * can't be taken while the family types contact details. Returns the token
 * the client must pass to `bookAppointment`. Same validation as a booking —
 * a slot you can't book can't be held.
 */
export async function holdSlot(input: {
  date: string;
  time: string;
  treatmentKey: TreatmentKey;
  /** dentist id, or null for "any dentist" — holds a chair */
  dentistId: number | null;
  /** who it's for — "kid" (under 12) or "adult" */
  ageGroup?: AgeGroup | null;
}): Promise<{ ok: boolean; token?: string; expiresAt?: string }> {
  if (await limited("hold", 30, 600)) return { ok: false };
  if (!input.date || !input.time || !input.treatmentKey) return { ok: false };
  const { isBookableTreatment } = await import("@/server/queries");
  if (!(await isBookableTreatment(input.treatmentKey))) return { ok: false };
  const group = isAgeGroup(input.ageGroup) ? input.ageGroup : null;
  if ((await slotVerdict(input.date, input.time, input.treatmentKey, input.dentistId, group)) !== "ok") {
    return { ok: false };
  }
  const { createHold } = await import("@/server/queries");
  const hold = await createHold({
    date: input.date,
    time: input.time,
    treatmentKey: input.treatmentKey,
    dentistId: input.dentistId,
  });
  if (!hold) return { ok: false }; // an active hold landed mid-flight
  return { ok: true, token: hold.token, expiresAt: hold.expiresAt.toISOString() };
}

/** release a hold early — the family picked a different slot or backed out */
export async function releaseSlotHold(token: string): Promise<void> {
  if (!token) return;
  const { releaseHold } = await import("@/server/queries");
  await releaseHold(token);
}

export async function bookAppointment(input: {
  date: string;
  time: string;
  treatmentKey: TreatmentKey;
  /** dentist id, or null for "any dentist" */
  dentistId: number | null;
  /** the name the family gives at the desk — a nickname is enough */
  childName: string;
  /** legacy: older clients sent a separate contact name; the booking name is used when absent */
  guardianName?: string;
  phone: string;
  forSelf?: boolean;
  /** who it's for — "kid" (under 12) or "adult"; only dentists who see that group are offered */
  ageGroup?: AgeGroup | null;
  /** token from holdSlot — the slot reservation being confirmed */
  holdToken?: string;
  /** LIFF ID token when the page runs inside LINE — verified server-side */
  lineIdToken?: string;
}): Promise<BookResult> {
  // minimal validation — never trust the client, even ours
  if (await limited("book", 20, 600)) return { ok: false, error: "invalid" };
  const name = typeof input.childName === "string" ? input.childName.trim().slice(0, 60) : "";
  if (!input.date || !input.time || !input.treatmentKey || !input.phone || !name) {
    return { ok: false, error: "invalid" };
  }
  if (!/^[0-9]{9,10}$/.test(input.phone.replace(/\D/g, ""))) {
    return { ok: false, error: "invalid" };
  }
  // only treatments the clinic shows on the website can be booked online
  const { isBookableTreatment } = await import("@/server/queries");
  if (!(await isBookableTreatment(input.treatmentKey))) return { ok: false, error: "invalid" };

  // consume the caller's hold first — deleting it means our own reservation
  // can't trip the checks below; if it lapsed and someone grabbed the slot
  // meanwhile, the normal validation still fails honestly
  const dentistId = input.dentistId;
  const ageGroup = isAgeGroup(input.ageGroup) ? input.ageGroup : null;
  if (input.holdToken) {
    const { releaseHold } = await import("@/server/queries");
    await releaseHold(input.holdToken);
  }

  // verify the LINE account up front — the booking is stamped with it (that is
  // how "my bookings" finds it, and the only way to cancel or move it later)
  // and it gets the push confirmation after. With LINE login configured a
  // booking without a verified account is refused.
  const identity = await patientIdentity(input.lineIdToken);
  if (!identity && process.env.LINE_LOGIN_CHANNEL_ID) return { ok: false, error: "line" };

  const verdict = await slotVerdict(input.date, input.time, input.treatmentKey, dentistId, ageGroup);
  if (verdict !== "ok") {
    // at capacity the pressure valve runs first — the oldest pooled booking
    // takes a remaining free dentist — and the newcomer is turned away either way
    if (dentistId === null && verdict === "slot_taken") {
      const { settlePool } = await import("@/server/queries");
      await settlePool(input.date, input.time);
    }
    return { ok: false, error: verdict };
  }

  const created = await createAppointment({
    date: input.date,
    time: input.time,
    treatmentKey: input.treatmentKey,
    dentistId,
    childName: name,
    guardianName: input.guardianName?.trim() || name,
    phone: input.phone,
    forSelf: input.forSelf ?? false,
    ageGroup,
    source: "online",
    price: null,
    lineUserId: identity?.userId,
    lineName: identity?.displayName,
    // nickname + phone only — no guardian/child records from the patient site
    register: false,
  });

  if (!created) return { ok: false, error: "slot_taken" };

  const { settlePool } = await import("@/server/queries");
  await settlePool(input.date, input.time);

  // confirm in their chat — any LINE failure degrades to a normal booking,
  // never a failed one
  if (identity) {
    const { pushLineText } = await import("@/server/line");
    await pushLineText(
      identity.userId,
      `จองคิวสำเร็จ ✓\nนัดของ ${name}\n${thaiDate(input.date)} เวลา ${input.time} น.\nรหัสจอง: ${created.ref}\nขอบคุณที่ใช้บริการ DentaKids ค่ะ`,
    );
  }

  revalidateAll();
  return { ok: true, ref: created.ref };
}

/**
 * Staff hands a pooled booking to a dentist. Guarded: the dentist must be
 * free and capable at that slot — first-come still wins over the pool, so a
 * specific booking that landed mid-flight keeps its chair.
 */
export async function assignPoolDentist(
  id: number,
  dentistId: number,
): Promise<{ ok: boolean; error?: "taken" | "invalid" }> {
  await guard();
  const { freeCapableAtSlot, updateAppointment } = await import("@/server/queries");
  const all = await listAppointmentsBetween("1970-01-01", "9999-12-31");
  const target = all.find((a) => a.id === id);
  if (!target || target.status === "cancelled" || target.dentistId !== null) {
    return { ok: false, error: "invalid" };
  }
  const free = await freeCapableAtSlot(target.date, target.time, target.treatmentKey, target.ageGroup);
  if (!free.some((f) => f.id === dentistId)) return { ok: false, error: "taken" };
  await updateAppointment(id, { dentistId });
  const { settlePool } = await import("@/server/queries");
  await settlePool(target.date, target.time);
  revalidateAll();
  return { ok: true };
}

/**
 * Who is on the patient site. Families sign in with LINE (the site runs as a
 * LIFF app inside the clinic's LINE OA), so "my bookings", cancel, postpone
 * and messages all hang off the verified LINE account — never a phone number,
 * which anyone could type. Only when LINE login isn't configured at all (local
 * dev and test scripts) does the token double as a stand-in identity.
 */
async function patientIdentity(lineIdToken: string | undefined) {
  if (!lineIdToken) return null;
  if (!process.env.LINE_LOGIN_CHANNEL_ID) {
    return process.env.NODE_ENV === "production"
      ? null
      : { userId: `dev:${lineIdToken.slice(0, 40)}`, displayName: "dev" };
  }
  const { verifyLineIdToken } = await import("@/server/line");
  return verifyLineIdToken(lineIdToken);
}

/** the patient-site "my bookings" list — everything this LINE account booked.
 *  null = the token was not accepted (the page asks to sign in again) */
export async function myBookingsByLine(lineIdToken: string) {
  if (await limited("lookup", 40, 600)) return null;
  const identity = await patientIdentity(lineIdToken);
  if (!identity) return null;
  const { listAppointmentsForLine } = await import("@/server/queries");
  const rows = await listAppointmentsForLine(identity.userId);
  // only what the family needs — staff notes, prices and the like stay inside
  return rows.map((a) => ({
    ref: a.ref,
    date: a.date,
    time: a.time,
    treatmentKey: a.treatmentKey,
    dentistSlug: a.dentistSlug,
    status: a.status,
    childName: a.childName,
    ageGroup: a.ageGroup,
  }));
}

/** what the clinic has sent this LINE account — the bell page on the site */
export async function myMessagesByLine(lineIdToken: string) {
  if (await limited("lookup", 40, 600)) return null;
  const identity = await patientIdentity(lineIdToken);
  if (!identity) return null;
  const { lineMessage } = await import("@/db/schema");
  const { and, desc, eq } = await import("drizzle-orm");
  const rows = await db
    .select({ id: lineMessage.id, text: lineMessage.text, at: lineMessage.createdAt })
    .from(lineMessage)
    .where(and(eq(lineMessage.lineUserId, identity.userId), eq(lineMessage.direction, "out")))
    .orderBy(desc(lineMessage.createdAt))
    .limit(50);
  return rows.map((r) => ({ id: r.id, text: r.text, at: r.at.toISOString() }));
}

/**
 * The booking this LINE account may still change: its own, confirmed (not yet
 * checked in), and not in the past. null otherwise.
 */
async function ownUpcomingBooking(ref: string, lineIdToken: string) {
  if (!ref || !lineIdToken) return null;
  const identity = await patientIdentity(lineIdToken);
  if (!identity) return null;
  const { listAppointmentsForLine } = await import("@/server/queries");
  const target = (await listAppointmentsForLine(identity.userId)).find((a) => a.ref === ref);
  if (!target || target.status !== "confirmed") return null;
  const { minutesOf, nowMinutes } = await import("@/lib/dates");
  const today = todayISO();
  if (target.date < today || (target.date === today && minutesOf(target.time) < nowMinutes())) return null;
  return target;
}

/** The patient cancelled their own booking (signed in with LINE). */
export async function cancelBooking(ref: string, lineIdToken: string): Promise<{ ok: boolean }> {
  if (await limited("cancel", 10, 600)) return { ok: false };
  const target = await ownUpcomingBooking(ref, lineIdToken);
  if (!target) return { ok: false };
  await updateAppointment(target.id, { status: "cancelled" });
  // a freed chair can home a pooled booking still waiting at that slot
  const { settlePool } = await import("@/server/queries");
  await settlePool(target.date, target.time);
  await dbInsertCancellationNotice(target.ref, target.childName, target.date, target.time);
  revalidateAll();
  return { ok: true };
}

/**
 * The patient postponed their own booking: the same appointment row moves to
 * a new date/time — same ref, treatment, dentist and child — so the old slot
 * frees up and the family never ends up holding two bookings. Same proof as
 * `cancelBooking` (ref + the booking's phone), same slot rules as a new
 * booking (`slotVerdict`), and the unique slot index still guards the race.
 */
export async function rescheduleBooking(input: {
  ref: string;
  /** the LIFF ID token — only the LINE account that booked may move it */
  lineIdToken: string;
  date: string;
  time: string;
  /** token from holdSlot — the new slot's reservation being confirmed */
  holdToken?: string;
}): Promise<BookResult> {
  if (await limited("reschedule", 10, 600)) return { ok: false, error: "invalid" };
  if (!input.ref || !input.date || !input.time) return { ok: false, error: "invalid" };

  // only this account's booking, still waiting to happen — not one already
  // checked in, finished, cancelled or in the past
  const target = await ownUpcomingBooking(input.ref, input.lineIdToken);
  if (!target) return { ok: false, error: "invalid" };
  if (target.date === input.date && target.time === input.time) return { ok: true, ref: target.ref };

  if (input.holdToken) {
    const { releaseHold } = await import("@/server/queries");
    await releaseHold(input.holdToken);
  }

  const verdict = await slotVerdict(input.date, input.time, target.treatmentKey, target.dentistId, target.ageGroup);
  if (verdict !== "ok") return { ok: false, error: verdict };

  try {
    await updateAppointment(target.id, { date: input.date, time: input.time });
  } catch {
    // the unique slot index fired — someone took that dentist's slot mid-flight
    return { ok: false, error: "slot_taken" };
  }

  const { settlePool } = await import("@/server/queries");
  await settlePool(target.date, target.time); // the old slot may home a pooled booking
  await settlePool(input.date, input.time);

  // a reminder already sent for the old date must not stop the new date's one
  const { messageLog } = await import("@/db/schema");
  const { and, eq, like } = await import("drizzle-orm");
  await db
    .delete(messageLog)
    .where(and(eq(messageLog.appointmentId, target.id), like(messageLog.kind, "reminder_%")));

  await db.insert(staffNotification).values({
    type: "reschedule",
    title: "ผู้ปกครองเลื่อนนัดหมาย",
    body: `${target.childName} เลื่อนนัดจาก ${target.date} ${target.time} น. เป็น ${input.date} ${input.time} น. (${target.ref})`,
    refCode: target.ref,
  });

  {
    const { lineTargetForAppointment } = await import("@/server/queries");
    const { pushLineText } = await import("@/server/line");
    const to = await lineTargetForAppointment(target.id);
    if (to) {
      await pushLineText(
        to,
        `เลื่อนนัดสำเร็จ ✓\nรหัสจอง: ${target.ref}\nนัดใหม่ ${thaiDate(input.date)} เวลา ${input.time} น.\nขอบคุณที่ใช้บริการ DentaKids ค่ะ`,
      );
    }
  }

  revalidateAll();
  return { ok: true, ref: target.ref };
}

/* ═══════════════════════════ staff: login ═══════════════════════════════ */

/**
 * The PIN gate — throttled hard because the PIN is short. A good PIN sets the
 * httpOnly cookie every staff action checks; the raw PIN never leaves this
 * function.
 */
export async function staffLogin(pin: string): Promise<{ ok: boolean }> {
  if (await limited("stafflogin", 5, 600)) return { ok: false };
  const { staffPinOk, staffGrantCookie } = await import("@/server/staffAuth");
  if (!staffPinOk(pin)) return { ok: false };
  await staffGrantCookie();
  return { ok: true };
}

export async function staffLogout(): Promise<void> {
  const { staffClearCookie } = await import("@/server/staffAuth");
  await staffClearCookie();
}

/* ═══════════════════════════ staff: appointments ════════════════════════ */

export async function staffCreateAppointment(input: {
  date: string;
  time: string;
  treatmentKey: TreatmentKey;
  dentistId: number;
  childName: string;
  guardianName: string;
  phone: string;
  source: "phone" | "walkin" | "online";
  note?: string;
  price?: number | null;
}) {
  await guard();
  const created = await createAppointment({ ...input, source: input.source });
  revalidateAll();
  return created?.ref ?? null;
}

export async function staffUpdateAppointment(id: number, patch: AppointmentUpdate) {
  await guard();
  const touchesSlot =
    patch.status !== undefined ||
    patch.date !== undefined ||
    patch.time !== undefined ||
    patch.dentistId !== undefined;
  const before = touchesSlot
    ? (await listAppointmentsBetween("1970-01-01", "9999-12-31")).find((a) => a.id === id)
    : undefined;
  await updateAppointment(id, patch);
  // cancelling, moving or (un)assigning can home a pooled booking waiting
  // at the affected slot — run the pressure valve on both ends of a move
  if (touchesSlot) {
    const { settlePool } = await import("@/server/queries");
    const rows = await listAppointmentsBetween("1970-01-01", "9999-12-31");
    const after = rows.find((a) => a.id === id);
    if (before) await settlePool(before.date, before.time);
    if (after && (!before || after.date !== before.date || after.time !== before.time)) {
      await settlePool(after.date, after.time);
    }
  }
  revalidateAll();
}

/**
 * The queue board's transitions: confirmed → arrived (check-in stamps the
 * clinic clock — it is the queue order key) → in_chair → completed, or
 * no_show when the family never turned up. None of these free the slot, so
 * no settlePool — only `cancelled` does, and it goes through
 * staffUpdateAppointment.
 */
export async function staffSetQueueStatus(
  id: number,
  /** "confirmed" = undo a check-in ticked by mistake */
  status: "confirmed" | "arrived" | "in_chair" | "completed" | "no_show",
) {
  await guard();
  await updateAppointment(id, {
    status,
    ...(status === "arrived" ? { checkedInAt: clinicNowHHMM() } : {}),
    ...(status === "confirmed" ? { checkedInAt: null } : {}),
  });
  if (status === "completed") {
    const { scheduleRecallForAppointment } = await import("@/server/clinical");
    await scheduleRecallForAppointment(id);
  }
  revalidateAll();
}

/** the booking-rules knob (chairs) the settings page owns */
export async function staffUpdateChairs(chairs: number) {
  await guard();
  const { setChairs } = await import("@/server/queries");
  await setChairs(chairs);
  revalidateAll();
}

export async function staffDeleteAppointment(id: number) {
  await guard();
  const rows = await listAppointmentsBetween("1970-01-01", "9999-12-31");
  const target = rows.find((a) => a.id === id);
  await deleteAppointment(id);
  if (target) {
    const { settlePool } = await import("@/server/queries");
    await settlePool(target.date, target.time);
  }
  revalidateAll();
}

/* ═══════════════════════════ staff: dentists ════════════════════════════ */

export async function staffUpdateDentist(slug: string, patch: DentistUpdate) {
  await guard();
  await updateDentist(slug, patch);
  revalidateAll();
}

export async function staffCreateDentist(input: NewDentistInput) {
  await guard();
  await createDentist(input);
  revalidateAll();
}

/* ═══════════════════════════ staff: patients ════════════════════════════ */

export async function staffUpsertPatient(input: CreatePatientInput) {
  await guard();
  await upsertGuardian(input);
  revalidateAll();
}

export async function staffUpdatePatient(id: number, patch: Partial<CreatePatientInput>) {
  await guard();
  await updatePatient(id, patch);
  revalidateAll();
}

export async function staffAddChild(patientId: number, child: string | ChildInput) {
  await guard();
  await addChildToGuardian(patientId, child);
  revalidateAll();
}

/* ═══════════════════════════ staff: waitlist (queue) ════════════════════ */

export async function staffAddWaitlist(input: {
  childName: string;
  guardianPhone?: string;
  treatmentKey: TreatmentKey;
  dentistId?: number | null;
  note?: string;
}) {
  await guard();
  await addWaitlist(input);
  revalidateAll();
}

/* ═══════════════════ staff: visit records (room page) ═══════════════════ */

/** save the dentist's record without closing the visit (mid-treatment edits) */
export async function staffSaveVisitRecord(input: VisitRecordInput) {
  await guard();
  const { upsertVisitRecord } = await import("@/server/queries");
  await upsertVisitRecord(input);
  revalidateAll();
}

/**
 * One tap on the room page: save the record AND close the visit — booking →
 * "completed", walk-in → "done". One round-trip so the chair frees at once.
 */
export async function staffFinishVisit(input: VisitRecordInput) {
  await guard();
  const { upsertVisitRecord, updateWaitlistStatus } = await import("@/server/queries");
  await upsertVisitRecord(input);
  const clinical = await import("@/server/clinical");
  if (input.appointmentId != null) {
    await updateAppointment(input.appointmentId, { status: "completed" });
    await clinical.scheduleRecallForAppointment(input.appointmentId);
  } else if (input.waitlistId != null) {
    await updateWaitlistStatus(input.waitlistId, "done");
  }
  revalidateAll();
}

export async function staffSetWaitlistStatus(id: number, status: WaitlistDTO["status"], dentistId?: number | null) {
  await guard();
  await updateWaitlistStatus(id, status, dentistId);
  revalidateAll();
}

export async function staffRemoveWaitlist(id: number) {
  await guard();
  await removeWaitlist(id);
  revalidateAll();
}

/* ═══════════════════════════ staff: prices & schedule ═══════════════════ */

export async function staffUpdatePrice(key: IconKey, price: number | null) {
  await guard();
  await updateTreatmentPrice(key, price);
  revalidateAll();
}

/**
 * A message from the desk into the family's LINE chat — used when the clinic
 * cancels or moves a booking, or just needs to tell them something. Goes to
 * the LINE account that made the booking; logged as "custom".
 */
export type FamilyMessageResult = "sent" | "no_line" | "not_configured" | "failed";

export async function staffMessageFamily(id: number, text: string): Promise<FamilyMessageResult> {
  await guard();
  const body = text.trim().slice(0, 2000);
  if (!body) return "failed";
  const { lineTargetForAppointment } = await import("@/server/queries");
  const to = await lineTargetForAppointment(id);
  if (!to) return "no_line";
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return "not_configured";
  const { pushLineText } = await import("@/server/line");
  const ok = await pushLineText(to, body).catch(() => false);
  if (!ok) return "failed";
  const { messageLog } = await import("@/db/schema");
  await db.insert(messageLog).values({ appointmentId: id, kind: "custom" });
  return "sent";
}

/* ═══════════════════════════ staff: patient file (full edition) ═════════ */

type Clinical = typeof import("@/server/clinical");

export async function staffPatientFile(childId: number) {
  await guard("patients");
  const { getPatientFile } = await import("@/server/clinical");
  return getPatientFile(childId);
}

export async function staffEnsurePatient(input: Parameters<Clinical["ensurePatient"]>[0]) {
  await guard("patients");
  const { ensurePatient } = await import("@/server/clinical");
  const id = await ensurePatient(input);
  revalidateAll();
  return id;
}

export async function staffChildForAppointment(appointmentId: number) {
  await guard("patients");
  const { childForAppointment } = await import("@/server/clinical");
  return childForAppointment(appointmentId);
}

export async function staffSetTeeth(input: Parameters<Clinical["setTeeth"]>[0]) {
  await guard("chart");
  const { setTeeth } = await import("@/server/clinical");
  await setTeeth(input);
  await logAction("บันทึกชาร์ตฟัน", `คนไข้ #${input.childId} · ซี่ ${input.teeth.join(" ")} · ${input.status}`);
}

export async function staffSavePlan(input: Parameters<Clinical["savePlan"]>[0]) {
  await guard("chart");
  const { savePlan } = await import("@/server/clinical");
  return savePlan(input);
}

export async function staffSignPlan(id: number, signature: string, signedBy: string) {
  await guard("patients");
  const { signPlan } = await import("@/server/clinical");
  const ok = await signPlan(id, signature, signedBy);
  if (ok) await logAction("เซ็นยอมรับแผนการรักษา", `แผน #${id} · ${signedBy}`);
  return ok;
}

export async function staffRemovePlan(id: number) {
  await guard("chart");
  const { removePlan } = await import("@/server/clinical");
  await removePlan(id);
}

export async function staffBillFromPlan(input: Parameters<Clinical["billFromPlan"]>[0]) {
  await guard("cashier");
  const { billFromPlan } = await import("@/server/clinical");
  return billFromPlan(input);
}

export async function staffTakeDeposit(input: Parameters<Clinical["takeDeposit"]>[0]) {
  await guard("cashier");
  const { takeDeposit } = await import("@/server/clinical");
  const id = await takeDeposit(input);
  if (id) await logAction("รับมัดจำ", `คนไข้ #${input.childId} · ${input.amount} บาท`);
  return id;
}

export async function staffSaveDoc(input: Parameters<Clinical["saveDoc"]>[0]) {
  await guard("chart");
  const { saveDoc } = await import("@/server/clinical");
  return saveDoc(input);
}

export async function staffRemoveDoc(id: number) {
  await guard("chart");
  const { removeDoc } = await import("@/server/clinical");
  await removeDoc(id);
  await logAction("ลบเอกสาร", `#${id}`);
}

export async function staffMedications() {
  await guard("chart");
  const { listMedications } = await import("@/server/clinical");
  return listMedications();
}

export async function staffSaveMedication(input: Parameters<Clinical["saveMedication"]>[0]) {
  await guard("chart");
  const { saveMedication } = await import("@/server/clinical");
  await saveMedication(input);
}

export async function staffUploadFile(input: Parameters<Clinical["uploadFile"]>[0]) {
  await guard("patients");
  const { uploadFile } = await import("@/server/clinical");
  return uploadFile(input);
}

export async function staffFileBody(id: number) {
  await guard("patients");
  const { getFileBody } = await import("@/server/clinical");
  return getFileBody(id);
}

export async function staffRemoveFile(id: number) {
  await guard("chart");
  const { removeFile } = await import("@/server/clinical");
  await removeFile(id);
  await logAction("ลบไฟล์คนไข้", `#${id}`);
}

export async function staffRecalls(filter: Parameters<Clinical["listRecalls"]>[0]) {
  await guard("patients");
  const { listRecalls } = await import("@/server/clinical");
  return listRecalls(filter);
}

export async function staffSetRecall(id: number, patch: Parameters<Clinical["setRecall"]>[1]) {
  await guard("patients");
  const { setRecall } = await import("@/server/clinical");
  await setRecall(id, patch);
}

/** a check-up reminder into the family's LINE chat */
export async function staffRemindRecall(id: number, text: string): Promise<FamilyMessageResult> {
  await guard("patients");
  const { listRecalls, lineTargetForChild, setRecall } = await import("@/server/clinical");
  const r = (await listRecalls({})).find((x) => x.id === id);
  if (!r) return "failed";
  const to = await lineTargetForChild(r.childId);
  if (!to) return "no_line";
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return "not_configured";
  const { pushLineText } = await import("@/server/line");
  const ok = await pushLineText(to, text.trim().slice(0, 2000)).catch(() => false);
  if (!ok) return "failed";
  await setRecall(id, { status: "contacted", contactNote: "ส่ง LINE เตือนแล้ว" });
  return "sent";
}

/* ═══════════════════════════ staff: stock, expenses, labs (full) ════════ */

type Stock = typeof import("@/server/stock");

export async function staffSuppliers() {
  await guard("stock");
  const { listSuppliers } = await import("@/server/stock");
  return listSuppliers();
}

export async function staffSaveSupplier(input: Parameters<Stock["saveSupplier"]>[0]) {
  await guard("stock");
  const { saveSupplier } = await import("@/server/stock");
  return saveSupplier(input);
}

export async function staffStock() {
  // the counter reads it too, for products it can sell
  await guard("cashier").catch(() => guard("stock"));
  const { listStock } = await import("@/server/stock");
  return listStock();
}

export async function staffSaveStockItem(input: Parameters<Stock["saveStockItem"]>[0]) {
  await guard("stock");
  const { saveStockItem } = await import("@/server/stock");
  return saveStockItem(input);
}

export async function staffAddMove(input: Parameters<Stock["addMove"]>[0]) {
  await guard("stock");
  const { addMove } = await import("@/server/stock");
  await addMove(input);
  await logAction("ปรับคลัง", `สินค้า #${input.itemId} · ${input.kind} ${input.qty}`);
}

export async function staffMoves(filter: Parameters<Stock["listMoves"]>[0]) {
  await guard("stock");
  const { listMoves } = await import("@/server/stock");
  return listMoves(filter);
}

export async function staffConsumables() {
  await guard("stock");
  const { listConsumables } = await import("@/server/stock");
  return listConsumables();
}

export async function staffSetConsumables(treatmentKey: string, lines: { itemId: number; qty: number }[]) {
  await guard("stock");
  const { setConsumables } = await import("@/server/stock");
  return setConsumables(treatmentKey, lines);
}

export async function staffExpenses(from: string, to: string) {
  await guard("cashier");
  const { listExpenses } = await import("@/server/stock");
  return listExpenses(from, to);
}

export async function staffSaveExpense(input: Parameters<Stock["saveExpense"]>[0]) {
  await guard("cashier");
  const { saveExpense } = await import("@/server/stock");
  await saveExpense(input);
  await logAction("บันทึกค่าใช้จ่าย", `${input.category} ${input.amount} บาท`);
}

export async function staffRemoveExpense(id: number) {
  await guard("cashier");
  const { removeExpense } = await import("@/server/stock");
  await removeExpense(id);
  await logAction("ลบค่าใช้จ่าย", `#${id}`);
}

export async function staffLabOrders(filter: Parameters<Stock["listLabOrders"]>[0]) {
  await guard("stock");
  const { listLabOrders } = await import("@/server/stock");
  return listLabOrders(filter);
}

export async function staffSaveLabOrder(input: Parameters<Stock["saveLabOrder"]>[0]) {
  await guard("stock");
  const { saveLabOrder } = await import("@/server/stock");
  return saveLabOrder(input);
}

export async function staffRemoveLabOrder(id: number) {
  await guard("stock");
  const { removeLabOrder } = await import("@/server/stock");
  return removeLabOrder(id);
}

/* ═══════════════════════════ staff: LINE chat (full edition) ════════════ */

export async function staffChats() {
  await guard("chat");
  const { listConversations } = await import("@/server/chat");
  return listConversations();
}

export async function staffChatThread(lineUserId: string) {
  await guard("chat");
  const { listMessages } = await import("@/server/chat");
  return listMessages(String(lineUserId).slice(0, 64));
}

export async function staffChatSend(lineUserId: string, text: string) {
  await guard("chat");
  const { currentUser } = await import("@/server/users");
  const me = await currentUser();
  const { sendMessage } = await import("@/server/chat");
  return sendMessage(String(lineUserId).slice(0, 64), text, me?.name || "คลินิก");
}

/* ═══════════════════════════ staff: accounts (full edition) ═════════════ */

export async function staffWhoAmI() {
  await guard();
  const { whoAmI } = await import("@/server/users");
  return whoAmI();
}

export async function staffSignIn(userId: number, pin: string) {
  await guard();
  if (await limited("staffuser", 10, 600)) return { ok: false };
  const { signIn } = await import("@/server/users");
  return signIn(userId, pin);
}

export async function staffSignOut() {
  await guard();
  const { signOut } = await import("@/server/users");
  await signOut();
}

export async function staffUsers() {
  await guard("users");
  const { listUsers } = await import("@/server/users");
  return listUsers();
}

/** with no accounts yet the app is open, so whoever sets it up makes the first (owner) */
export async function staffSaveUser(input: Parameters<typeof import("@/server/users").saveUser>[0]) {
  await guard("users");
  const { saveUser } = await import("@/server/users");
  const r = await saveUser(input);
  if (r.ok) await logAction(input.id ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้", `${input.name} · ${input.role}`);
  return r;
}

/** clock in/out — anyone at the PC, proven by their own PIN */
export async function staffPunch(userId: number, pin: string) {
  await guard();
  if (await limited("punch", 20, 600)) return { ok: false };
  const { punch } = await import("@/server/users");
  return punch(userId, pin);
}

export async function staffClock(from: string, to: string) {
  await guard("users");
  const { listClock } = await import("@/server/users");
  return listClock(from, to);
}

export async function staffAudit() {
  await guard("users");
  const { listAudit } = await import("@/server/users");
  return listAudit();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ═══════════════════════════ staff: data in / out (full edition) ════════ */

export async function staffExportPatients() {
  await guard("users");
  const { exportPatientsCsv } = await import("@/server/dataio");
  await logAction("ส่งออกรายชื่อคนไข้");
  return exportPatientsCsv();
}

export async function staffImportPatients(rows: Parameters<typeof import("@/server/dataio").importPatients>[0]) {
  await guard("users");
  const { importPatients } = await import("@/server/dataio");
  const r = await importPatients(rows);
  await logAction("นำเข้ารายชื่อคนไข้", `เพิ่ม ${r.created} · อัปเดต ${r.updated} · ข้าม ${r.skipped}`);
  revalidateAll();
  return r;
}

export async function staffExportBills(from: string, to: string) {
  await guard("reports");
  const { exportBillsCsv } = await import("@/server/dataio");
  return exportBillsCsv(ISO.test(from) ? from : todayISO(), ISO.test(to) ? to : todayISO());
}

/* ═══════════════════════════ staff: reports (full edition) ══════════════ */

export async function staffReport(from: string, to: string) {
  await guard("reports");
  const { report } = await import("@/server/reports");
  return report(ISO.test(from) ? from : todayISO(), ISO.test(to) ? to : todayISO());
}

export async function staffDfStatement(dentistSlug: string, from: string, to: string) {
  await guard("reports");
  const { dfStatement } = await import("@/server/reports");
  return dfStatement(dentistSlug, ISO.test(from) ? from : todayISO(), ISO.test(to) ? to : todayISO());
}

/* ═══════════════════════════ staff: billing (full edition) ══════════════ */

export async function staffCashierDay(date: string) {
  await guard("cashier");
  const { cashierDay } = await import("@/server/billing");
  return cashierDay(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO());
}

export async function staffOpenBill(input: { appointmentId?: number | null; waitlistId?: number | null }) {
  await guard("cashier");
  const { openBillForVisit } = await import("@/server/billing");
  return openBillForVisit(input);
}

export async function staffOpenBlankBill(input: { patientName: string; phone: string }) {
  await guard("cashier");
  const { openBlankBill } = await import("@/server/billing");
  return openBlankBill(input);
}

export async function staffSaveBill(id: number, input: Parameters<typeof import("@/server/billing").saveBill>[1]) {
  await guard("cashier");
  const { saveBill } = await import("@/server/billing");
  return saveBill(id, input);
}

export async function staffAddPayment(id: number, input: Parameters<typeof import("@/server/billing").addPayment>[1]) {
  await guard("cashier");
  const { addPayment } = await import("@/server/billing");
  const r = await addPayment(id, input);
  if (r.ok) await logAction("รับชำระ", `บิล #${id} · ${input.method} ${input.amount} บาท${r.receiptNo ? ` · ${r.receiptNo}` : ""}`);
  return r;
}

export async function staffVoidBill(id: number, reason: string) {
  await guard("void");
  const { voidBill } = await import("@/server/billing");
  const ok = await voidBill(id, reason);
  if (ok) await logAction("ยกเลิกบิล", `บิล #${id} — ${reason}`);
  return ok;
}

export async function staffDayClose(date: string) {
  await guard("cashier");
  const { dayClose } = await import("@/server/billing");
  return dayClose(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO());
}

export async function staffClaims(from: string, to: string) {
  await guard("cashier");
  const { listClaims } = await import("@/server/billing");
  return listClaims(ISO.test(from) ? from : todayISO(), ISO.test(to) ? to : todayISO());
}

export async function staffSetClaimStatus(paymentIds: number[], status: import("@/lib/billing").ClaimStatus) {
  await guard("cashier");
  const { setClaimStatus } = await import("@/server/billing");
  await setClaimStatus(paymentIds, status);
  await logAction("อัปเดตสถานะเบิกสิทธิ์", `${paymentIds.length} รายการ → ${status}`);
}

export async function staffSetDisplay(state: Parameters<typeof import("@/server/billing").setDisplay>[0]) {
  await guard("cashier");
  const { setDisplay } = await import("@/server/billing");
  await setDisplay(state);
}

export async function staffNextVisit(phone: string, after: string) {
  await guard("cashier");
  const { nextVisitFor } = await import("@/server/billing");
  return nextVisitFor(phone, after);
}

export async function staffBillingSettings() {
  await guard();
  const { getBillingSettings, listDfRules } = await import("@/server/billing");
  const [settings, dfRules] = await Promise.all([getBillingSettings(), listDfRules()]);
  return { settings, dfRules };
}

export async function staffSaveBillingSettings(input: Parameters<typeof import("@/server/billing").saveBillingSettings>[0]) {
  await guard("finance_settings");
  const { saveBillingSettings } = await import("@/server/billing");
  await saveBillingSettings(input);
  await logAction("แก้ตั้งค่าใบเสร็จ");
}

export async function staffAftercareNotes() {
  await guard("finance_settings");
  const { getAftercareNotes } = await import("@/server/billing");
  return getAftercareNotes();
}

export async function staffSaveAftercareNote(treatmentKey: string, text: string) {
  await guard("finance_settings");
  const { saveAftercareNote } = await import("@/server/billing");
  await saveAftercareNote(treatmentKey, text);
}

export async function staffSaveDfRule(input: Parameters<typeof import("@/server/billing").saveDfRule>[0]) {
  await guard("finance_settings");
  const { saveDfRule } = await import("@/server/billing");
  await saveDfRule(input);
  await logAction("แก้กฎค่าแพทย์", `${input.dentistSlug ?? "ทุกคน"} · ${input.treatmentKey ?? "ทุกบริการ"} · ${input.value}${input.mode === "percent" ? "%" : " บาท"}`);
}

export async function staffRemoveDfRule(id: number) {
  await guard("finance_settings");
  const { removeDfRule } = await import("@/server/billing");
  await removeDfRule(id);
  await logAction("ลบกฎค่าแพทย์", `#${id}`);
}

/** a dentist's leave (ลา) — those days drop out of online booking */
export async function staffAddDentistLeave(dentistSlug: string, start: string, end: string, note: string) {
  await guard();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { ok: false };
  const { addDentistLeave } = await import("@/server/queries");
  const ok = await addDentistLeave(dentistSlug, start, end, note);
  revalidateAll();
  return { ok };
}

export async function staffRemoveDentistLeave(id: number) {
  await guard();
  const { removeDentistLeave } = await import("@/server/queries");
  await removeDentistLeave(id);
  revalidateAll();
}

/** ตั้งค่า → บริการ & ราคา: add a treatment (its own name, a reused icon) */
export async function staffCreateTreatment(input: {
  nameTh: string;
  nameEn?: string;
  iconKey: IconKey;
  tint?: string;
  groupKey?: string;
  price: number | null;
}): Promise<{ ok: boolean; key?: string }> {
  await guard();
  const { isIconKey } = await import("@/data/icons");
  if (!input.nameTh?.trim() || !isIconKey(input.iconKey)) return { ok: false };
  const { createTreatment } = await import("@/server/queries");
  const key = await createTreatment(input);
  revalidateAll();
  return { ok: true, key };
}

/** edit a treatment's name / icon / colour / group / price, or show-hide it on the website */
export async function staffUpdateTreatment(
  key: string,
  patch: {
    nameTh?: string | null;
    nameEn?: string | null;
    iconKey?: IconKey;
    tint?: string | null;
    groupKey?: string | null;
    price?: number | null;
    isActive?: boolean;
  },
) {
  await guard();
  const { isIconKey } = await import("@/data/icons");
  if (patch.iconKey !== undefined && !isIconKey(patch.iconKey)) return;
  const { updateTreatment } = await import("@/server/queries");
  await updateTreatment(key, patch);
  revalidateAll();
}

export async function staffUpdateDay(day: string, patch: { isOpen?: boolean; start?: string; end?: string }) {
  await guard();
  await updateClinicDay(day, patch);
  revalidateAll();
}

/** the /clinic page + home info card content */
export async function staffUpdateClinicInfo(patch: {
  phone?: string;
  phoneDisplay?: string;
  lineId?: string;
  lineUrl?: string;
  mapUrl?: string;
  directionsUrl?: string;
  addressTh?: string;
  addressEn?: string;
  landmarkTh?: string;
  landmarkEn?: string;
}) {
  await guard();
  await updateClinicInfo(patch);
  revalidateAll();
}

export async function staffAddHoliday(start: string, end: string, name: string) {
  await guard();
  await addHolidayRange(start, end, name);
  revalidateAll();
}

export async function staffRemoveHoliday(id: number) {
  await guard();
  await removeHoliday(id);
  revalidateAll();
}

/* ═══════════════════════════ staff: notifications ═══════════════════════ */

export async function staffMarkNotificationsRead() {
  await guard();
  await markNotificationsRead();
  revalidateStaff();
}

/** convenience read the staff console uses after mutations */
export async function staffPrices() {
  await guard();
  return priceMap();
}

/* ═══════════════════════════ staff bootstrap ════════════════════════════ */

/**
 * One round-trip that gives the staff console its entire working state.
 * Shapes are the UI's own (StaffAppointment, EditableDentist, PatientRecord…),
 * produced by the adapters in src/lib/staffConvert.ts, so the components keep
 * rendering exactly what they rendered against the old localStorage mock.
 */
export async function staffBootstrap() {
  await guard();
  const {
    toUIAppointments,
    toUIEditableDentists,
    toUIPatients,
    toUIVisitRecords,
    toUIWaitlist,
    toUINotifications,
  } = await import("@/lib/staffConvert");
  const {
    listAppointmentsBetween,
    listDentists,
    listPatients,
    listWaitlist,
    listVisitRecordsForDate,
    listNotifications,
    listClinicDays,
    listHolidays,
    priceMap,
    getChairs,
    listTreatmentCatalog,
    listDentistLeaves,
  } = await import("@/server/queries");

  const today = (await import("@/lib/dates")).todayISO();

  const lineUnread = await (await import("@/server/chat")).unreadCount().catch(() => 0);
  const [appts, dentists, patients, waitlist, visitRecords, notifications, days, holidays, prices, chairs, treatments, dentistLeaves] =
    await Promise.all([
      listAppointmentsBetween("1970-01-01", "9999-12-31"),
      listDentists(),
      listPatients(),
      listWaitlist(),
      listVisitRecordsForDate(today),
      listNotifications(),
      listClinicDays(),
      listHolidays(),
      priceMap(),
      getChairs(),
      listTreatmentCatalog(),
      listDentistLeaves(),
    ]);

  return {
    today,
    appointments: toUIAppointments(appts),
    dentists: toUIEditableDentists(dentists),
    patients: toUIPatients(patients),
    waitlist: toUIWaitlist(waitlist),
    visitRecords: toUIVisitRecords(visitRecords),
    notifications: toUINotifications(notifications),
    schedule: days,
    holidays,
    servicePrices: prices,
    treatments,
    dentistLeaves,
    settings: { chairs },
    /** unanswered LINE messages — the full edition's แชท LINE badge */
    lineUnread,
  };
}

export type StaffBootstrap = Awaited<ReturnType<typeof staffBootstrap>>;

