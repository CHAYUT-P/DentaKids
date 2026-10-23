/**
 * Full-system walkthrough test — simulates exactly what a parent and a
 * receptionist do, through the same code the UI calls (server actions),
 * verifying every surface afterwards. Run: pnpm e2e:test
 */
import "dotenv/config";

async function main() {
  // the families here have no real LINE login: with LINE switched off the
  // patient actions take the token as a stand-in account (dev only), and no
  // message is pushed to anyone
  delete process.env.LINE_LOGIN_CHANNEL_ID;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const FAMILY = "e2e-family";

  const actions = await import("../src/server/actions");
  const queries = await import("../src/server/queries");
  const { todayISO, addDays, weekdayIndex, minutesOf } = await import("../src/lib/dates");

  const today = todayISO();
  let passed = 0, failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  console.log("\n— 1. Parent books online (new family) —");
  // find a day naree works, next week
  let date = addDays(today, 7);
  while (![2, 3, 5, 6].includes(weekdayIndex(date))) date = addDays(date, 1);

  // pick a slot no leftover run has taken, per dentist availability
  const allSlots = await (await import("../src/server/queries")).slotsForDate(date);
  const freeTimes = [...new Set(allSlots.filter((s) => !s.taken).map((s) => s.time))].sort();
  const time = freeTimes.find((t) => t >= "14:00") ?? freeTimes[0];
  console.log(`  (using ${date} at ${time})`);
  const result = await actions.bookAppointment({ ageGroup: "kid",
    date, time, treatmentKey: "fluoride",
    dentistId: null, // "any dentist" — the UI's default choice
    // the patient site sends only the name to give at the desk + a phone
    childName: "น้องเทสเตอร์",
    phone: "0912345678",
    lineIdToken: FAMILY,
  });
  ok(`booking confirmed with ref ${result.ref}`, result.ok && !!result.ref, JSON.stringify(result));
  if (!result.ok) process.exit(1);

  console.log("\n— 2. Booking visible in the system (pooled) —");
  const mine = (await actions.myBookingsByLine(FAMILY)) ?? [];
  ok(
    "patient /bookings finds it by the LINE account",
    mine.some((m) => m.ref === result.ref),
    `got ${mine.map((m) => m.ref).join(",") || "none"}`,
  );
  const stranger = (await actions.myBookingsByLine("someone-else")) ?? [];
  ok("another account does not see it", !stranger.some((m) => m.ref === result.ref));
  const staffList = await queries.listAppointmentsBetween(today, addDays(today, 30));
  const onStaff = staffList.find(a => a.ref === result.ref);
  ok("staff list has it pooled (no dentist yet)", !!onStaff && onStaff.dentistId === null);
  const notifs = await queries.listNotifications();
  ok("staff notification bell has it", notifs.some(n => n.type === "online_booking" && n.refCode === result.ref));

  console.log("\n— 2b. Staff hands the pool booking to a dentist —");
  const capableFree = await queries.freeCapableAtSlot(date, time, "fluoride");
  ok("a capable dentist is free at that slot", capableFree.length > 0);
  const dentistId = capableFree[0].id;
  const dentistSlug = capableFree[0].slug;
  const assigned = await actions.assignPoolDentist(onStaff!.id, dentistId);
  ok("assign succeeds", assigned.ok);
  const staffList2 = await queries.listAppointmentsBetween(today, addDays(today, 30));
  const onStaff2 = staffList2.find(a => a.ref === result.ref);
  ok("staff list now shows the dentist", !!onStaff2 && onStaff2.dentistSlug === dentistSlug);

  console.log("\n— 3. Slot now reads taken —");
  const slots = await queries.slotsForDate(date);
  const takenSlot = slots.find(s => s.dentistSlug === dentistSlug && s.time === time);
  ok(`${time} with ${dentistSlug} shows taken`, takenSlot?.taken === true);
  const others = slots.filter(s => s.time === time && !s.taken);
  ok("other dentists still free", others.length > 0);

  console.log("\n— 4. Double-booking refused, specific bypasses pool —");
  const clash = await actions.bookAppointment({ ageGroup: "kid",
    date, time, treatmentKey: "checkup",
    dentistId,
    childName: "น้องชนกัน", guardianName: "คุณชน", phone: "0988888888", forSelf: false,
  });
  ok("second booking at same slot rejected", !clash.ok && clash.error === "slot_taken");

  console.log("\n— 4b. Kids / adults —");
  {
    // naree takes fluoride for kids only: an adult can't book her for it,
    // a kid can, and "any dentist" for an adult never lands on her
    const before = (await queries.listDentists()).find((d) => d.slug === "naree")!;
    const fluorideTreats = [...new Set([...before.treats, "fluoride" as const])];
    await actions.staffUpdateDentist("naree", { treats: fluorideTreats, treatAges: { fluoride: "kids" } });
    const naree = (await queries.listDentists()).find((d) => d.slug === "naree")!;
    ok("dentist setting saved (fluoride: kids only)", naree.treatAges.fluoride === "kids");
    const forAdults = await queries.capableDentistIds("fluoride", "adult");
    const forKids = await queries.capableDentistIds("fluoride", "kid");
    ok("not offered to adults", !forAdults.includes(naree.id));
    ok("offered to kids", forKids.includes(naree.id));
    let d2 = addDays(today, 8);
    while (!(await queries.slotsForDate(d2)).some((r) => r.dentistSlug === "naree" && !r.taken)) d2 = addDays(d2, 1);
    const t2 = (await queries.slotsForDate(d2)).find((r) => r.dentistSlug === "naree" && !r.taken)!.time;
    const adultTry = await actions.bookAppointment({
      date: d2, time: t2, treatmentKey: "fluoride", dentistId: naree.id,
      childName: "ผู้ใหญ่ทดสอบ", phone: "0911111111", ageGroup: "adult", lineIdToken: FAMILY,
    });
    ok("adult booking with a kids-only dentist is refused", !adultTry.ok);
    const kidTry = await actions.bookAppointment({
      date: d2, time: t2, treatmentKey: "fluoride", dentistId: naree.id,
      childName: "เด็กทดสอบ", phone: "0911111111", ageGroup: "kid", lineIdToken: FAMILY,
    });
    ok("kid booking with her is accepted", kidTry.ok);
    const kidRow = (await queries.listAppointmentsBetween(d2, d2)).find((a) => a.ref === kidTry.ref);
    ok("booking remembers it's for a kid", kidRow?.ageGroup === "kid");
    if (kidTry.ok) await actions.cancelBooking(kidTry.ref!, FAMILY);
    await actions.staffUpdateDentist("naree", { treats: before.treats, treatAges: before.treatAges }); // restore
  }

  console.log("\n— 4c. One-hour treatments hold two half-hours —");
  {
    const before = (await queries.listTreatmentCatalog()).find((t) => t.key === "whitening")!;
    await actions.staffUpdateTreatment("whitening", { durationMin: 60 });
    ok("whitening now takes 1 hour", (await queries.treatmentDuration("whitening")) === 60);
    // a dentist who does whitening, on a day with four free half-hours in a
    // row (whatever their real shift is): a b c d
    const doc = (await queries.listDentists()).find((d) => d.isActive && d.treats.includes("whitening"))!;
    let d3 = addDays(today, 9);
    let run: string[] = [];
    for (let k = 0; k < 30 && run.length < 4; k++, d3 = addDays(d3, 1)) {
      const rows = (await queries.slotsForDate(d3)).filter((r) => r.dentistId === doc.id).sort((x, y) => (x.time < y.time ? -1 : 1));
      for (let n = 0; n + 3 < rows.length; n++) {
        const four = rows.slice(n, n + 4);
        const steps = four.every((r, q) => q === 0 || minutesOf(r.time) - minutesOf(four[q - 1].time) === 30);
        if (steps && four.every((r) => !r.taken)) { run = four.map((r) => r.time); break; }
      }
      if (run.length === 4) break;
    }
    const [a, b, c, dd] = run;
    const long = await actions.bookAppointment({
      date: d3, time: b, treatmentKey: "whitening", dentistId: doc.id,
      childName: "ฟอกสีทดสอบ", phone: "0922222222", ageGroup: "adult", lineIdToken: FAMILY,
    });
    ok(`1-hour booking at ${b} accepted`, long.ok, JSON.stringify(long));
    const grid = (await queries.slotsForDate(d3)).filter((r) => r.dentistId === doc.id);
    ok(`${b} and ${c} both taken`, [b, c].every((t) => grid.find((r) => r.time === t)?.taken));
    ok(`${dd} still free`, grid.find((r) => r.time === dd)?.taken === false);
    const second = await actions.bookAppointment({ ageGroup: "kid",
      date: d3, time: c, treatmentKey: "checkup", dentistId: doc.id,
      childName: "ชนครึ่งหลัง", phone: "0933333333", lineIdToken: FAMILY,
    });
    ok(`${c} refused (inside the 1-hour booking)`, !second.ok);
    const before1h = await actions.bookAppointment({
      date: d3, time: a, treatmentKey: "whitening", dentistId: doc.id,
      childName: "ชนครึ่งแรก", phone: "0944444444", ageGroup: "adult", lineIdToken: FAMILY,
    });
    ok(`1-hour at ${a} refused (runs into ${b})`, !before1h.ok);
    const row = (await queries.listAppointmentsBetween(d3, d3)).find((x) => x.ref === long.ref);
    ok("booking stored as 60 minutes", row?.durationMin === 60);
    if (long.ok) await actions.cancelBooking(long.ref!, FAMILY);
    const freed = (await queries.slotsForDate(d3)).filter((r) => r.dentistId === doc.id);
    ok("cancelling frees both half-hours", [b, c].every((t) => freed.find((r) => r.time === t)?.taken === false));
    await actions.staffUpdateTreatment("whitening", { durationMin: before.durationMin }); // restore
  }

  console.log("\n— 5. Online booking is name + phone only —");
  ok("booking keeps the name given", onStaff?.childName === "น้องเทสเตอร์");
  ok("no guardian/child record created from the patient site", onStaff?.guardianId === null && onStaff?.childId === null);

  console.log("\n— 6. Staff manages the queue —");
  await actions.staffAddWaitlist({ childName: "น้องวอคอิน", guardianPhone: "0912345678", treatmentKey: "checkup" });
  let wl = await queries.listWaitlist();
  // take the newest "waiting" entry with this name (earlier runs may linger)
  const mineQ = wl.filter(w => w.childName === "น้องวอคอิน" && w.status === "waiting");
  const entry = mineQ[mineQ.length - 1];
  ok("walk-in added to waitlist", !!entry);
  await actions.staffSetWaitlistStatus(entry!.id, "in_chair");
  wl = await queries.listWaitlist();
  ok("queue advanced to in_chair", wl.find(w => w.id === entry!.id)?.status === "in_chair");
  await actions.staffSetWaitlistStatus(entry!.id, "done");
  wl = await queries.listWaitlist();
  ok("queue completed", wl.find(w => w.id === entry!.id)?.status === "done");
  // leave no test walk-in on today's real board
  await actions.staffRemoveWaitlist(entry!.id);

  console.log("\n— 7. Staff edits content —");
  const naree = (await queries.listDentists()).find(d => d.slug === "naree")!;
  await actions.staffUpdateDentist("naree", { text: { th: { blurb: "ดูแลเด็กเล็กและการมาหาหมอฟันครั้งแรก (แก้ไขแล้ว)" } } });
  const naree2 = (await queries.listDentists()).find(d => d.slug === "naree")!;
  ok("dentist blurb edit persisted", naree2.text.th.blurb.includes("แก้ไขแล้ว"));
  await actions.staffUpdateDentist("naree", { text: { th: { blurb: naree.text.th.blurb } } }); // restore

  await actions.staffUpdatePrice("fluoride", 777);
  const prices = await queries.priceMap();
  ok("price edit persisted", prices.fluoride === 777);
  await actions.staffUpdatePrice("fluoride", 600); // restore

  console.log("\n— 8. Patient cancels —");
  const hijack = await actions.cancelBooking(result.ref!, "someone-else");
  ok("another account cannot cancel it", !hijack.ok);
  const cancelled = await actions.cancelBooking(result.ref!, FAMILY);
  ok("the family cancels it", cancelled.ok);
  const after = (await actions.myBookingsByLine(FAMILY)) ?? [];
  ok("booking now cancelled", after.find((m) => m.ref === result.ref)?.status === "cancelled");
  const again = await actions.cancelBooking(result.ref!, FAMILY);
  ok("a cancelled booking can't be cancelled twice", !again.ok);
  const freed = (await queries.slotsForDate(date)).find(s => s.dentistSlug === dentistSlug && s.time === time);
  ok("slot freed for others", freed?.taken === false);
  const cancelNotifs = await queries.listNotifications();
  ok("staff told about cancellation", cancelNotifs.some(n => n.type === "cancellation" && n.refCode === result.ref));

  console.log("\n— 9. Booking window (how far ahead families may book) —");
  const savedWindow = await queries.getBookingWindowDays();
  let far = addDays(today, 300);
  while (![2, 3, 5, 6].includes(weekdayIndex(far))) far = addDays(far, 1);
  const farTime = [...new Set((await queries.slotsForDate(far)).filter((s) => !s.taken).map((s) => s.time))].sort()[0];
  await actions.staffUpdateBookingRules({ windowDays: 14 });
  const tooFar = await actions.bookAppointment({ ageGroup: "kid",
    date: far, time: farTime, treatmentKey: "fluoride", dentistId: null,
    childName: "น้องไกล", phone: "0912345678", lineIdToken: FAMILY,
  });
  ok("14-day window: the server refuses a date 10 months ahead", !tooFar.ok, JSON.stringify(tooFar));
  ok("14-day window: no hold that far ahead either", !(await actions.holdSlot({ date: far, time: farTime, treatmentKey: "fluoride", dentistId: null })).ok);
  const farMonth = far.slice(0, 8) + "01";
  ok("14-day window: the calendar gets no days that far ahead", Object.keys((await actions.bookingAvailability(farMonth))?.slots ?? {}).length === 0);
  await actions.staffUpdateBookingRules({ windowDays: 365 });
  ok("window saved as 1 year", (await queries.getBookingWindowDays()) === 365);
  ok("1-year window: the calendar loads that month", far in ((await actions.bookingAvailability(farMonth))?.slots ?? {}));
  const yearAhead = await actions.bookAppointment({ ageGroup: "kid",
    date: far, time: farTime, treatmentKey: "fluoride", dentistId: null,
    childName: "น้องไกล", phone: "0912345678", lineIdToken: FAMILY,
  });
  ok(`1-year window: booking ${far} works`, yearAhead.ok, JSON.stringify(yearAhead));
  if (yearAhead.ref) await actions.cancelBooking(yearAhead.ref, FAMILY);
  await actions.staffUpdateBookingRules({ windowDays: 400 });
  ok("never more than a year", (await queries.getBookingWindowDays()) === 365);
  await actions.staffUpdateBookingRules({ windowDays: savedWindow });

  console.log("\n— 10. Availability in one batch, staff download slimmed —");
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const batch = await queries.slotsForDates(days14);
  const oneByOne = await Promise.all(days14.map((d) => queries.slotsForDate(d)));
  ok("batched slots equal the day-by-day answer", days14.every((d, i) => JSON.stringify(batch[d]) === JSON.stringify(oneByOne[i])));
  const boot = await actions.staffBootstrap();
  // older rows ride along only when changed in the last day
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");
  const stale = await db.execute<{ id: number }>(
    sql`select id from appointment where date < ${boot.appointmentsFrom} and updated_at < now() - interval '1 day'`,
  );
  const staleIds = new Set([...stale].map((r) => String(r.id)));
  ok(
    "staff download: from 30 days back, older only if changed in the last day",
    boot.appointmentsFrom === addDays(today, -30) && !boot.appointments.some((a) => staleIds.has(String(a.id))),
  );
  const older = await actions.staffAppointmentsBefore(boot.appointmentsFrom);
  ok("older history loads separately, only before that date", older.every((a) => a.date < boot.appointmentsFrom));

  console.log("\n— 11. Book-before, cancel-before, cancel message —");
  const rulesBefore = await queries.getBookingRules();
  await actions.staffUpdateBookingRules({ windowDays: 30, leadHours: 1, cancelHours: 0 });
  let soonDay = addDays(today, 1);
  while (![2, 3, 5, 6].includes(weekdayIndex(soonDay))) soonDay = addDays(soonDay, 1);
  const soonTime = [...new Set((await queries.slotsForDate(soonDay)).filter((x) => !x.taken).map((x) => x.time))].sort()[0];
  await actions.staffUpdateBookingRules({ leadHours: 168 });
  const tooSoon = await actions.bookAppointment({ ageGroup: "kid",
    date: soonDay, time: soonTime, treatmentKey: "fluoride", dentistId: null,
    childName: "น้องเร็ว", phone: "0912345678", lineIdToken: FAMILY,
  });
  ok("book-before 168 h: a booking within the week is refused", !tooSoon.ok && tooSoon.error === "invalid", JSON.stringify(tooSoon));
  await actions.staffUpdateBookingRules({ leadHours: 1 });
  const soonOk = await actions.bookAppointment({ ageGroup: "kid",
    date: soonDay, time: soonTime, treatmentKey: "fluoride", dentistId: null,
    childName: "น้องเร็ว", phone: "0912345678", lineIdToken: FAMILY,
    note: "ฟันกรามซ้ายปวดตอนกลางคืน", urgent: true,
  });
  ok("book-before 1 h: the same booking works", soonOk.ok, JSON.stringify(soonOk));
  const { URGENT_MARK } = await import("../src/lib/urgent");
  const { db: ndb } = await import("../src/db/client");
  const { appointment: apptT } = await import("../src/db/schema");
  const { eq: neq } = await import("drizzle-orm");
  const [soonFull] = await ndb.select({ note: apptT.note }).from(apptT).where(neq(apptT.ref, soonOk.ref ?? ""));
  ok("pain/emergency note saved with its mark", !!soonFull?.note?.startsWith(URGENT_MARK) && soonFull.note.includes("ฟันกราม"));
  ok(
    "staff told it's urgent",
    (await queries.listNotifications()).some((n) => n.refCode === soonOk.ref && n.title.includes("ปวด/ฉุกเฉิน")),
  );
  await actions.staffUpdateBookingRules({ cancelHours: 168 });
  const late = await actions.cancelBooking(soonOk.ref!, FAMILY);
  ok("cancel-before 168 h: the family can't cancel online", !late.ok && late.error === "too_late", JSON.stringify(late));
  const lateMove = await actions.rescheduleBooking({ ref: soonOk.ref!, lineIdToken: FAMILY, date: soonDay, time: soonTime });
  ok("…nor move it", !lateMove.ok && lateMove.error === "too_late", JSON.stringify(lateMove));
  await actions.staffUpdateBookingRules({ cancelHours: 0 });
  ok("cancel-before 0: now they can", (await actions.cancelBooking(soonOk.ref!, FAMILY)).ok);
  ok("rules stay in range", (await actions.staffUpdateBookingRules({ leadHours: 9999, cancelHours: -5 })).leadHours === 168);

  console.log("\n— 12. Day queue (full day, no fixed time) —");
  const days = await queries.listClinicDays();
  const { weekday: dayKey } = await import("../src/lib/dates");
  let qDay = addDays(today, 2);
  while (!days.find((d) => d.day === dayKey(qDay))?.isOpen) qDay = addDays(qDay, 1);
  await actions.staffUpdateBookingRules({ dayQueueMax: 2 });
  const qBase = { date: qDay, treatmentKey: "checkup" as const, ageGroup: "kid" as const, phone: "0933333333" };
  const q1 = await actions.joinDayQueue({ ...qBase, childName: "e2e-q1", lineIdToken: "e2e-q-fam1", urgent: true });
  ok("a family joins the day's queue", q1.ok && q1.ref.startsWith("Q-"), JSON.stringify(q1));
  const q1again = await actions.joinDayQueue({ ...qBase, childName: "e2e-q1", lineIdToken: "e2e-q-fam1" });
  ok("joining again gives the same place", q1again.ok && q1.ok && q1again.ref === q1.ref && q1again.already);
  const q2 = await actions.joinDayQueue({ ...qBase, childName: "e2e-q2", lineIdToken: "e2e-q-fam2" });
  const q3 = await actions.joinDayQueue({ ...qBase, childName: "e2e-q3", lineIdToken: "e2e-q-fam3" });
  ok("the clinic's cap (2) holds", q2.ok && !q3.ok && q3.error === "full", JSON.stringify(q3));
  const boot2 = await actions.staffBootstrap();
  ok("staff see the sign-ups", boot2.dayQueue.filter((x) => x.visitDate === qDay && x.childName.startsWith("e2e-q")).length === 2);
  const myQueue = await actions.myDayQueueByLine("e2e-q-fam1");
  ok("the family sees theirs in my bookings", myQueue?.some((x) => x.ref === (q1.ok ? q1.ref : "")) === true);
  ok("someone else can't cancel it", !(await actions.cancelDayQueueEntry(q1.ok ? q1.ref : "", "e2e-q-fam2")).ok);
  ok("the family cancels", (await actions.cancelDayQueueEntry(q1.ok ? q1.ref : "", "e2e-q-fam1")).ok);
  const q3b = await actions.joinDayQueue({ ...qBase, childName: "e2e-q3", lineIdToken: "e2e-q-fam3" });
  ok("a freed place can be taken", q3b.ok);
  const q2row = boot2.dayQueue.find((x) => x.childName === "e2e-q2")!;
  await actions.staffSetDayQueueStatus(q2row.id, "waiting");
  const { db: qdb } = await import("../src/db/client");
  const { waitlistEntry: wl2 } = await import("../src/db/schema");
  const { eq: qeq } = await import("drizzle-orm");
  const [arrivedRow] = await qdb.select().from(wl2).where(qeq(wl2.id, q2row.id));
  ok("the desk ticks one in: it becomes a walk-in with an arrival time", arrivedRow.status === "waiting" && /^\d{2}:\d{2}$/.test(arrivedRow.arrivedAt));
  // leave no test sign-ups behind, and the rules as they were
  const { like: qlike } = await import("drizzle-orm");
  await qdb.delete(wl2).where(qlike(wl2.childName, "e2e-q%"));
  await actions.staffUpdateBookingRules(rulesBefore);

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
