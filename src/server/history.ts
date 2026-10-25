/**
 * The booking history (visit_event) and the website's demand log
 * (booking_attempt) — see their notes in src/db/schema.ts. Nothing reads
 * these yet; they're collected from launch day so reports and forecasts
 * later have real history to work from.
 *
 * Every write here is best-effort: a booking that went through must never
 * fail because its history line couldn't be written. A failure is reported
 * to the error log instead.
 *
 * No `server-only` import: queries.ts (which scripts also load) calls in.
 */

import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "@/db/client";
import { appointment, bookingAttempt, visitEvent, waitlistEntry } from "@/db/schema";

export type VisitEventKind = "booked" | "moved" | "dentist" | "status" | "edited" | "deleted" | "walkin";

export interface Actor {
  actor: "family" | "staff" | "system";
  name: string;
}

export const SYSTEM: Actor = { actor: "system", name: "" };

export function familyActor(lineName?: string | null): Actor {
  return { actor: "family", name: (lineName ?? "").slice(0, 80) };
}

/** the staff member signed in on this device (full edition); unnamed in the queue edition */
export async function staffActor(): Promise<Actor> {
  try {
    const { currentUser } = await import("@/server/users");
    const u = await currentUser();
    // id 0 = no staff accounts set up (everyone shares the clinic PIN)
    return { actor: "staff", name: u && u.id !== 0 ? u.name : "" };
  } catch {
    return { actor: "staff", name: "" };
  }
}

/** a booking as it stood — what the `prev…` columns record */
export interface BookingSnap {
  status: string;
  date: string;
  time: string;
  dentistId: number | null;
}

async function failed(e: unknown, where: string) {
  const { reportError } = await import("@/server/monitor");
  await reportError("server", e, `history: ${where}`);
}

/**
 * Record a change to booking `id`, after it was saved: the row is read back,
 * so the event holds what really landed. `prev` = the booking before.
 */
export async function logBooking(
  id: number,
  kind: VisitEventKind,
  who: Actor,
  prev?: BookingSnap | null,
  detail = "",
): Promise<void> {
  try {
    const [row] = await db
      .select({ ref: appointment.ref, status: appointment.status, date: appointment.date, time: appointment.time, dentistId: appointment.dentistId })
      .from(appointment)
      .where(eq(appointment.id, id));
    if (!row) return;
    await db.insert(visitEvent).values({
      appointmentId: id,
      ref: row.ref,
      kind,
      actor: who.actor,
      actorName: who.name,
      status: row.status,
      date: row.date,
      time: row.time,
      dentistId: row.dentistId,
      prevStatus: prev?.status ?? "",
      prevDate: prev?.date ?? "",
      prevTime: prev?.time ?? "",
      prevDentistId: prev?.dentistId ?? null,
      detail: detail.slice(0, 300),
    });
  } catch (e) {
    await failed(e, `booking ${kind}`);
  }
}

/** a booking removed outright (staff "delete") — the event keeps its ref and last state */
export async function logBookingDeleted(prev: BookingSnap & { id: number; ref: string }, who: Actor): Promise<void> {
  try {
    await db.insert(visitEvent).values({
      appointmentId: prev.id,
      ref: prev.ref,
      kind: "deleted",
      actor: who.actor,
      actorName: who.name,
      prevStatus: prev.status,
      prevDate: prev.date,
      prevTime: prev.time,
      prevDentistId: prev.dentistId,
    });
  } catch (e) {
    await failed(e, "booking deleted");
  }
}

/** a walk-in: arrived ("walkin"), moved along the queue ("status"), removed ("deleted") */
export async function logWalkin(id: number, kind: "walkin" | "status" | "deleted", who: Actor, prevStatus = ""): Promise<void> {
  try {
    const [row] = await db
      .select({ status: waitlistEntry.status, dentistId: waitlistEntry.dentistId, arrivedAt: waitlistEntry.arrivedAt, createdAt: waitlistEntry.createdAt })
      .from(waitlistEntry)
      .where(eq(waitlistEntry.id, id));
    const { todayISO } = await import("@/lib/dates");
    await db.insert(visitEvent).values({
      waitlistId: id,
      kind,
      actor: who.actor,
      actorName: who.name,
      status: kind === "deleted" ? "" : (row?.status ?? ""),
      date: row ? todayISO(row.createdAt) : "",
      time: row?.arrivedAt ?? "",
      dentistId: row?.dentistId ?? null,
      prevStatus: kind === "deleted" ? (row?.status ?? "") : prevStatus,
    });
  } catch (e) {
    await failed(e, `walk-in ${kind}`);
  }
}

/** a family picked a time on the website — held, or refused and why */
export async function logAttempt(input: {
  date: string;
  time: string;
  dentistId: number | null;
  treatmentKey: string;
  ageGroup?: string | null;
  lineUserId?: string | null;
  purpose: "new" | "move";
  outcome: string;
}): Promise<void> {
  try {
    await db.insert(bookingAttempt).values({
      date: input.date.slice(0, 10),
      time: input.time.slice(0, 5),
      dentistId: input.dentistId,
      treatmentKey: input.treatmentKey.slice(0, 40),
      ageGroup: input.ageGroup ?? null,
      lineUserId: input.lineUserId ?? "",
      purpose: input.purpose,
      outcome: input.outcome.slice(0, 20),
    });
  } catch (e) {
    await failed(e, "attempt");
  }
}

/** the family's latest hold of that time (last hour) became booking `appointmentId` */
export async function markAttemptBooked(lineUserId: string | null | undefined, date: string, time: string, appointmentId: number): Promise<void> {
  if (!lineUserId) return;
  try {
    const [hit] = await db
      .select({ id: bookingAttempt.id })
      .from(bookingAttempt)
      .where(
        and(
          eq(bookingAttempt.lineUserId, lineUserId),
          eq(bookingAttempt.date, date),
          eq(bookingAttempt.time, time),
          eq(bookingAttempt.outcome, "held"),
          gt(bookingAttempt.createdAt, new Date(Date.now() - 60 * 60_000)),
        ),
      )
      .orderBy(desc(bookingAttempt.id))
      .limit(1);
    if (hit) await db.update(bookingAttempt).set({ outcome: "booked", appointmentId }).where(eq(bookingAttempt.id, hit.id));
  } catch (e) {
    await failed(e, "attempt booked");
  }
}
