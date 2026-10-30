/**
 * End-to-end database verification. Run: pnpm db:test
 *
 * Exercises, against the live DATABASE_URL:
 *   1. seed idempotency
 *   2. availability: taken slots match booked appointments
 *   3. booking: create → appears in lists; double-booking is refused
 *   4. pool ("any dentist"): joins unassigned, waits while chairs spare,
 *      specific bookings bypass it, pressure settles oldest first
 *   5. cancel → frees the slot + staff notification
 *   6. staff mutations: status/price/schedule/waitlist
 *   7. roster: deactivating a dentist removes their availability
 *
 * Cleans up after itself — the database is left as the seed left it.
 */
import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  appointment,
  dentist,
  staffNotification,
  waitlistEntry,
} from "../src/db/schema";
import {
  addDays,
  todayISO,
  weekday,
} from "../src/lib/dates";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = drizzle(postgres(url, { prepare: false }));

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* find the next Monday–Friday day (the clinic is closed on Sunday and the
   test needs an open day whose shifts are seeded for every dentist) */
function nextWeekday(): string {
  let iso = addDays(todayISO(), 1);
  while (weekday(iso) === "sun") iso = addDays(iso, 1);
  return iso;
}

async function main() {
  console.log("Denta Kids DB verification\n");

  const today = todayISO();

  // ── 0. clean slate for deterministic assertions ─────────────────────────
  await db.delete(appointment);
  await db.delete(waitlistEntry);
  await db.delete(staffNotification);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("pnpm", ["db:seed"], { cwd: process.cwd() });
  check("seed runs", true);

  // ── 1. seed idempotency ─────────────────────────────────────────────────
  // Row count stays put across runs, and the active roster is exactly the
  // dentists in src/data/dentists.ts (older rows are retired, not deleted).
  const { dentists: rosterSeed } = await import("../src/data/dentists");
  const c1 = (await db.select().from(dentist)).length;
  await promisify(execFile)("pnpm", ["db:seed"], { cwd: process.cwd() });
  const c2 = (await db.select().from(dentist)).length;
  const activeCount = (await db.select().from(dentist).where(eq(dentist.isActive, true))).length;
  check("seed is idempotent (dentists stable)", c1 === c2, `${c1} → ${c2}`);
  check(
    "roster matches src/data/dentists.ts",
    activeCount === rosterSeed.length,
    `active ${activeCount} vs roster ${rosterSeed.length}`,
  );

  // ── 2. availability reflects bookings ───────────────────────────────────
  const { slotsForDate } = await import("../src/server/queries");
  const todaySlots = await slotsForDate(today);
  const bookedToday = await db
    .select({ time: appointment.time, dentistId: appointment.dentistId })
    .from(appointment)
    .where(and(eq(appointment.date, today), eq(appointment.status, "confirmed")));
  const allTaken = todaySlots.filter((s) => s.taken);
  const everyBookingHasSlot = bookedToday.every((b) =>
    allTaken.some((s) => s.dentistId === b.dentistId && s.time === b.time),
  );
  check(
    "every booked slot appears as taken in availability",
    everyBookingHasSlot,
    `${bookedToday.length} bookings vs ${allTaken.length} taken`,
  );

  // ── 3. createAppointment + double-booking guard ─────────────────────────
  const { createAppointment, listAppointmentsBetween } = await import("../src/server/queries");
  const dentistsAll = await db.select().from(dentist).where(eq(dentist.isActive, true));
  const naree = dentistsAll.find((d) => d.slug === "onanong")!;
  const targetDate = nextWeekday();
  const targetTime = "13:00";

  const made = await createAppointment({
    date: targetDate,
    time: targetTime,
    treatmentKey: "checkup",
    dentistId: naree.id,
    childName: "น้องเทสต์",
    guardianName: "คุณพ่อทดสอบ",
    phone: "0990000001",
    source: "online",
  });
  check("booking creates an appointment", made !== null && !!made?.ref, made?.ref);

  const clash = await createAppointment({
    date: targetDate,
    time: targetTime,
    treatmentKey: "filling",
    dentistId: naree.id,
    childName: "น้องชน",
    guardianName: "คุณแม่ชน",
    phone: "0990000002",
    source: "online",
  });
  check("double-booking the same dentist+slot is refused", clash === null);

  const phoneBookings = (await listAppointmentsBetween("1970-01-01", "9999-12-31")).filter(
    (a) => a.phone === "0990000001",
  );
  check("booking is findable by phone (patient /bookings)", phoneBookings.length === 1);

  const notif = await db.select().from(staffNotification);
  check("staff got an online-booking notification", notif.some((n) => n.type === "online_booking"));

  // ── 4. pool ("any dentist") ───────────────────────────────────────────
  // chairs=2 keeps the scenario small; restored to 3 in cleanup
  const {
    setChairs,
    getChairs,
    liveAtSlot,
    settlePool,
    freeCapableAtSlot,
  } = await import("../src/server/queries");
  await setChairs(2);
  check("chair count persists", (await getChairs()) === 2);

  // a weekday slot with no demo bookings and full checkup coverage
  const poolDate = nextWeekday();
  const dayRows = await slotsForDate(poolDate);
  const poolTime =
    ["10:00", "10:30", "11:00", "13:30", "14:00", "14:30", "15:00"].find((t) => {
      const at = dayRows.filter((s) => s.time === t);
      return at.length >= 3 && at.every((s) => !s.taken);
    }) ?? "10:00";

  const pooled = await createAppointment({
    date: poolDate,
    time: poolTime,
    treatmentKey: "checkup",
    dentistId: null,
    childName: "น้องพูล",
    guardianName: "คุณแม่พูล",
    phone: "0990000011",
    source: "online",
  });
  check("any-dentist booking joins the pool unassigned", pooled !== null && pooled.dentistId === null);

  const live1 = await liveAtSlot(poolDate, poolTime);
  check("pooled booking holds a chair", live1.length === 1 && live1[0].dentistId === null);

  const settledEarly = await settlePool(poolDate, poolTime);
  check("pool waits while chairs spare", settledEarly.length === 0);

  const freeTwo = (await freeCapableAtSlot(poolDate, poolTime, "checkup")).slice(0, 2);
  const spec1 = await createAppointment({
    date: poolDate, time: poolTime, treatmentKey: "checkup", dentistId: freeTwo[0].id,
    childName: "น้องเจาะจง1", guardianName: "คุณแม่เจาะจง", phone: "0990000012", source: "online",
  });
  const spec2 = await createAppointment({
    date: poolDate, time: poolTime, treatmentKey: "checkup", dentistId: freeTwo[1].id,
    childName: "น้องเจาะจง2", guardianName: "คุณแม่เจาะจง", phone: "0990000013", source: "online",
  });
  check("specific bookings bypass the pool (first-come wins)", spec1 !== null && spec2 !== null);

  const settled = await settlePool(poolDate, poolTime);
  const poolAfter = await liveAtSlot(poolDate, poolTime);
  check(
    "pressure settles the oldest pooled booking first",
    settled.length === 1 && settled[0] === pooled!.ref && poolAfter.every((r) => r.dentistId !== null),
    settled.join(","),
  );

  // ── 5. cancel frees the slot ────────────────────────────────────────────
  await db
    .update(appointment)
    .set({ status: "cancelled" })
    .where(eq(appointment.id, made!.id));
  const slotsAfterCancel = await slotsForDate(targetDate);
  const slotFreed = !slotsAfterCancel.some(
    (s) => s.dentistId === naree.id && s.time === targetTime && s.taken,
  );
  check("cancelled booking frees the slot", slotFreed);

  // ── 6. staff mutations ──────────────────────────────────────────────────
  const { updateTreatmentPrice, listTreatments, updateClinicDay, listClinicDays } =
    await import("../src/server/queries");
  await updateTreatmentPrice("fluoride", 999);
  const fluoride = (await listTreatments()).find((t) => t.key === "fluoride");
  check("price update lands in DB", fluoride?.price === 999);
  await updateTreatmentPrice("fluoride", 600); // restore

  // open Sunday and give one dentist a Sunday shift, then put both back as
  // they were — the test must never change the clinic's real hours
  const sunBefore = (await listClinicDays()).find((d) => d.day === "sun");
  await updateClinicDay("sun", { isOpen: true, start: "10:00", end: "12:00" });
  const sun = (await listClinicDays()).find((d) => d.day === "sun");
  check("clinic day update lands in DB", sun?.isOpen === true);
  const { dentistShift } = await import("../src/db/schema");
  const { and: andOp, eq: eqOp } = await import("drizzle-orm");
  // an active one: a retired dentist never has bookable slots
  const [anyDentist] = await db.select({ id: dentist.id }).from(dentist).where(eqOp(dentist.isActive, true)).limit(1);
  const [shiftBefore] = await db
    .select()
    .from(dentistShift)
    .where(andOp(eqOp(dentistShift.dentistId, anyDentist.id), eqOp(dentistShift.weekday, 0)));
  await db
    .insert(dentistShift)
    .values({ dentistId: anyDentist.id, weekday: 0, enabled: true, start: "10:00", end: "12:00" })
    .onConflictDoUpdate({ target: [dentistShift.dentistId, dentistShift.weekday], set: { enabled: true, start: "10:00", end: "12:00" } });
  let sunday = addDays(today, 1);
  while (weekday(sunday) !== "sun") sunday = addDays(sunday, 1);
  const sunSlots = await slotsForDate(sunday);
  check("opened Sunday produces bookable slots", sunSlots.length > 0);
  if (shiftBefore) {
    await db
      .update(dentistShift)
      .set({ enabled: shiftBefore.enabled, start: shiftBefore.start, end: shiftBefore.end })
      .where(eqOp(dentistShift.id, shiftBefore.id));
  } else {
    await db.delete(dentistShift).where(andOp(eqOp(dentistShift.dentistId, anyDentist.id), eqOp(dentistShift.weekday, 0)));
  }
  if (sunBefore) {
    await updateClinicDay("sun", { isOpen: sunBefore.isOpen, start: sunBefore.start, end: sunBefore.end }); // restore
  }

  // waitlist round-trip
  const { addWaitlist, listWaitlist, updateWaitlistStatus, removeWaitlist } =
    await import("../src/server/queries");
  await addWaitlist({ childName: "น้องคิว", treatmentKey: "checkup" });
  const wl = await listWaitlist();
  const entry = wl.find((w) => w.childName === "น้องคิว");
  check("waitlist add works", entry !== undefined);
  await updateWaitlistStatus(entry!.id, "in_chair");
  const wl2 = (await listWaitlist()).find((w) => w.id === entry!.id);
  check("waitlist status update works", wl2?.status === "in_chair");
  await removeWaitlist(entry!.id);
  check("waitlist remove works", !(await listWaitlist()).some((w) => w.id === entry!.id));

  // queue board: check-in → waiting, call → serving, done → off the board
  const { queueDay, queueStatus, updateAppointment } = await import("../src/server/queries");
  const qAppt = await createAppointment({
    date: today,
    time: "08:30",
    treatmentKey: "checkup",
    dentistId: naree.id,
    childName: "น้องคิวเช็ค",
    guardianName: "คุณแม่คิวเช็ค",
    phone: "0990000021",
    source: "walkin",
  });
  check("booking for the queue board is created", qAppt !== null);
  await updateAppointment(qAppt!.id, { status: "arrived", checkedInAt: "08:55" });
  let board = await queueDay(today);
  check(
    "checked-in booking joins the queue",
    board.waiting.some((w) => w.ref === qAppt!.ref && w.kind === "booking"),
  );
  const lookedUp = await queueStatus({ date: today, ref: qAppt!.ref });
  check(
    "queue lookup reports position",
    lookedUp.found && lookedUp.state === "waiting" && (lookedUp.position ?? 0) >= 1,
    JSON.stringify(lookedUp),
  );
  const lookedUpElsewhere = await queueStatus({ date: addDays(today, 1), ref: qAppt!.ref });
  check("queue lookup only finds a booking on its own day", !lookedUpElsewhere.found);
  await updateAppointment(qAppt!.id, { status: "in_chair" });
  board = await queueDay(today);
  check(
    "called booking moves to serving",
    board.serving.some((w) => w.ref === qAppt!.ref) &&
      !board.waiting.some((w) => w.ref === qAppt!.ref),
  );
  await updateAppointment(qAppt!.id, { status: "completed" });
  board = await queueDay(today);
  check(
    "completed booking leaves the queue",
    !board.waiting.concat(board.serving).some((w) => w.ref === qAppt!.ref),
  );
  await db.delete(appointment).where(eq(appointment.id, qAppt!.id));

  const seededWalk = (await listWaitlist()).find((w) => w.status === "waiting");
  const lookedUpWalk = await queueStatus({ date: today, ref: `W-${seededWalk!.id}` });
  check(
    "walk-in ref lookup reports position",
    lookedUpWalk.found && lookedUpWalk.state === "waiting" && (lookedUpWalk.position ?? 0) >= 1,
    JSON.stringify(lookedUpWalk),
  );

  // ── 7. roster deactivation ──────────────────────────────────────────────
  const { updateDentist } = await import("../src/server/queries");
  const siriporn = dentistsAll.find((d) => d.slug === "phannathip")!;
  await updateDentist("phannathip", { isActive: false });
  const slotsNoSiriporn = await slotsForDate(targetDate);
  check(
    "deactivated dentist leaves availability",
    !slotsNoSiriporn.some((s) => s.dentistId === siriporn.id),
  );
  await updateDentist("phannathip", { isActive: true }); // restore

  // ── cleanup: remove test bookings/notifications, reseed demo ────────────
  await db.delete(appointment).where(eq(appointment.phone, "0990000001"));
  await db.delete(appointment).where(eq(appointment.phone, "0990000002"));
  await db.delete(appointment).where(eq(appointment.phone, "0990000011"));
  await db.delete(appointment).where(eq(appointment.phone, "0990000012"));
  await db.delete(appointment).where(eq(appointment.phone, "0990000013"));
  await db.delete(staffNotification);
  const { setChairs: restoreChairs } = await import("../src/server/queries");
  await restoreChairs(3);
  await promisify(execFile)("pnpm", ["db:seed"], { cwd: process.cwd() });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
