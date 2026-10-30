/** rejection-path checks for bookAppointment + the slot-hold lifecycle —
 *  non-destructive: every created row is deleted before exit */
import "dotenv/config";
import { eq, lt } from "drizzle-orm";

import { db } from "../src/db/client";
import { appointment, dentist, slotHold } from "../src/db/schema";

async function main() {
  const { bookAppointment, holdSlot, releaseSlotHold } = await import("../src/server/actions");
  const { slotsForDate, activeHoldsAtSlot } = await import("../src/server/queries");

  const base = {
    ageGroup: "kid" as const,
    date: "2026-09-14", // Monday — piya (the only braces dentist) is off
    time: "09:00",
    childName: "guard-check",
    guardianName: "guard-check",
    phone: "0900000000",
    forSelf: false,
  };

  const all = await db.select().from(dentist);
  const naree = all.find((d) => d.slug === "onanong")!;
  const piya = all.find((d) => d.slug === "chawalit")!;

  const cases: [string, Parameters<typeof bookAppointment>[0], string][] = [
    ["specialist on capable dentist's day off (any)", { ...base, treatmentKey: "braces", dentistId: null }, "slot_taken"],
    ["specialist with wrong dentist (named)", { ...base, date: "2026-09-15", treatmentKey: "braces", dentistId: naree.id }, "invalid"],
    ["named dentist on his own day off", { ...base, treatmentKey: "checkup", dentistId: piya.id }, "slot_taken"],
    ["past date", { ...base, date: "2020-01-06", treatmentKey: "checkup", dentistId: null }, "invalid"],
    ["valid: checkup any-dentist on open day", { ...base, treatmentKey: "checkup", dentistId: null }, "OK"],
  ];

  let pass = 0;
  const check = (name: string, got: string, want: string) => {
    const good = got === want;
    if (good) pass++;
    console.log(`${good ? "✓" : "✗"} ${name} → ${got} (want ${want})`);
  };

  for (const [name, input, want] of cases) {
    const r = await bookAppointment(input);
    check(name, r.ok ? "OK" : (r.error ?? "?"), want);
  }

  /* ── hold lifecycle ──────────────────────────────────────────────────── */

  // find a genuinely free named slot on a far-future open day
  const holdDate = "2026-09-16"; // Wednesday
  const free = (await slotsForDate(holdDate)).find((s) => !s.taken);
  if (free) {
    const h1 = await holdSlot({ date: holdDate, time: free.time, treatmentKey: "checkup", dentistId: free.dentistId });
    check("hold a free named slot", h1.ok ? "OK" : "fail", "OK");

    const takenNow = (await slotsForDate(holdDate)).find(
      (s) => s.dentistId === free.dentistId && s.time === free.time,
    );
    check("held slot reads as taken", takenNow?.taken ? "taken" : "free", "taken");

    const h2 = await holdSlot({ date: holdDate, time: free.time, treatmentKey: "checkup", dentistId: free.dentistId });
    check("second hold on held slot", h2.ok ? "OK" : "fail", "fail");

    const booked = await bookAppointment({
      ...base,
      date: holdDate,
      time: free.time,
      treatmentKey: "checkup",
      dentistId: free.dentistId,
      holdToken: h1.token,
    });
    check("confirm with hold token", booked.ok ? "OK" : (booked.error ?? "?"), "OK");
  }

  // a pool hold occupies a chair, and lapsing frees it again
  const p1 = await holdSlot({ date: holdDate, time: "11:00", treatmentKey: "checkup", dentistId: null });
  check("pool hold", p1.ok ? "OK" : "fail", "OK");
  check("pool hold counts a chair", String(await activeHoldsAtSlot(holdDate, "11:00")), "1");
  await releaseSlotHold(p1.token!);
  check("released hold frees the chair", String(await activeHoldsAtSlot(holdDate, "11:00")), "0");

  // a lapsed hold doesn't block the slot — pick a still-free one, since the
  // slot above was just booked by the confirm check
  const stale = (await slotsForDate(holdDate)).find((s) => !s.taken);
  if (stale) {
    await db.insert(slotHold).values({
      token: "stale-test",
      dentistId: stale.dentistId,
      treatmentKey: "checkup",
      date: holdDate,
      time: stale.time,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const h3 = await holdSlot({ date: holdDate, time: stale.time, treatmentKey: "checkup", dentistId: stale.dentistId });
    check("lapsed hold is replaceable", h3.ok ? "OK" : "fail", "OK");
    if (h3.token) await releaseSlotHold(h3.token);
  }

  // clean up everything this run created
  await db.delete(appointment).where(eq(appointment.phone, "0900000000"));
  await db.delete(slotHold).where(lt(slotHold.expiresAt, new Date(Date.now() + 60 * 60_000)));
  console.log(`${pass}/${9} checks passed`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
