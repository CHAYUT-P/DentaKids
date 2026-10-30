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
  const { todayISO, addDays, minutesOf } = await import("../src/lib/dates");

  const today = todayISO();
  let passed = 0, failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };
  /** a day and time that can really be booked — found by trying a hold (then
   *  letting it go), so the test never depends on which weekday it runs on */
  const bookable = async (from: string, treatmentKey: string, dentistId: number | null, slug?: string) => {
    for (let i = 0; i < 21; i++) {
      const day = addDays(from, i);
      const times = [...new Set((await queries.slotsForDate(day)).filter((x) => !x.taken && (!slug || x.dentistSlug === slug)).map((x) => x.time))].sort();
      for (const time of times) {
        const h = await actions.holdSlot({ date: day, time, treatmentKey: treatmentKey as never, dentistId, ageGroup: "kid", lineIdToken: "e2e-probe" });
        if (h.ok && h.token) {
          await actions.releaseSlotHold(h.token);
          return { day, time };
        }
      }
    }
    throw new Error(`no bookable time for ${treatmentKey} from ${from}`);
  };

  // start from the default booking rules (a run that stopped early could
  // have left test values), and put the clinic's own back at the end
  const rulesAtStart = await queries.getBookingRules();
  await actions.staffUpdateBookingRules({ windowDays: 14, leadHours: 1, cancelHours: 0 });

  console.log("\n— 1. Parent books online (new family) —");
  // a day next week when a dentist who does fluoride is free
  const { day: date, time } = await bookable(addDays(today, 7), "fluoride", null);
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
    const before = (await queries.listDentists()).find((d) => d.slug === "onanong")!;
    const fluorideTreats = [...new Set([...before.treats, "fluoride" as const])];
    await actions.staffUpdateDentist("onanong", { treats: fluorideTreats, treatAges: { fluoride: "kids" } });
    const naree = (await queries.listDentists()).find((d) => d.slug === "onanong")!;
    ok("dentist setting saved (fluoride: kids only)", naree.treatAges.fluoride === "kids");
    const forAdults = await queries.capableDentistIds("fluoride", "adult");
    const forKids = await queries.capableDentistIds("fluoride", "kid");
    ok("not offered to adults", !forAdults.includes(naree.id));
    ok("offered to kids", forKids.includes(naree.id));
    let d2 = addDays(today, 8);
    while (!(await queries.slotsForDate(d2)).some((r) => r.dentistSlug === "onanong" && !r.taken)) d2 = addDays(d2, 1);
    const t2 = (await queries.slotsForDate(d2)).find((r) => r.dentistSlug === "onanong" && !r.taken)!.time;
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
    await actions.staffUpdateDentist("onanong", { treats: before.treats, treatAges: before.treatAges }); // restore
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
  const naree = (await queries.listDentists()).find(d => d.slug === "onanong")!;
  await actions.staffUpdateDentist("onanong", { text: { th: { blurb: "ดูแลเด็กเล็กและการมาหาหมอฟันครั้งแรก (แก้ไขแล้ว)" } } });
  const naree2 = (await queries.listDentists()).find(d => d.slug === "onanong")!;
  ok("dentist blurb edit persisted", naree2.text.th.blurb.includes("แก้ไขแล้ว"));
  await actions.staffUpdateDentist("onanong", { text: { th: { blurb: naree.text.th.blurb } } }); // restore

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
  // ~10 months ahead, a day when a dentist who does fluoride works
  const fluorideDocs = await queries.capableDentistIds("fluoride", "kid");
  const fluorideFree = async (d: string) =>
    [...new Set((await queries.slotsForDate(d)).filter((s) => !s.taken && fluorideDocs.includes(s.dentistId)).map((s) => s.time))].sort();
  let far = addDays(today, 300);
  while ((await fluorideFree(far)).length === 0) far = addDays(far, 1);
  const farTime = (await fluorideFree(far))[0];
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
  const rulesBefore = rulesAtStart;
  await actions.staffUpdateBookingRules({ windowDays: 30, leadHours: 1, cancelHours: 0 });
  const { day: soonDay, time: soonTime } = await bookable(addDays(today, 1), "fluoride", null);
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

  console.log("\n— 12. Settings stay on the half-hour grid; restoring a booking is guarded —");
  const daysNow = await queries.listClinicDays();
  const openDayRow = daysNow.find((d) => d.isOpen)!;
  let threw = false;
  try { await actions.staffUpdateDay(openDayRow.day, { start: "08:45" }); } catch { threw = true; }
  ok("an opening time like 08:45 is refused", threw);
  ok("…and nothing was saved", (await queries.listClinicDays()).find((d) => d.day === openDayRow.day)?.start === openDayRow.start);
  const nareeNow = (await queries.listDentists()).find((d) => d.slug === "onanong")!;
  threw = false;
  try {
    await actions.staffUpdateDentist("onanong", { shifts: [{ weekday: 2, enabled: true, start: "09:15", end: "17:00" }] });
  } catch { threw = true; }
  ok("a shift starting 09:15 is refused", threw);
  ok("…and naree's shifts are unchanged", JSON.stringify((await queries.listDentists()).find((d) => d.slug === "onanong")!.shifts) === JSON.stringify(nareeNow.shifts));
  // a cancelled booking whose time was taken since can't simply come back
  // the first day ahead with a free time for naree
  let rDay = addDays(today, 3);
  let rTime: string | undefined;
  for (let i = 0; i < 30 && !rTime; i++, rDay = addDays(rDay, 1)) {
    rTime = (await queries.slotsForDate(rDay)).filter((x) => !x.taken && x.dentistSlug === "onanong").map((x) => x.time).sort()[0];
    if (rTime) break;
  }
  ok("found a free time for the restore test", !!rTime, rDay);
  if (!rTime) process.exit(1);
  const first = await actions.staffCreateAppointment({ date: rDay, time: rTime, treatmentKey: "checkup", dentistId: naree.id, childName: "คืนนัด-1", guardianName: "x", phone: "0955555555", source: "phone" });
  const firstId = (await queries.listAppointmentsBetween(rDay, rDay)).find((a) => a.ref === first)?.id ?? -1;
  await actions.staffUpdateAppointment(firstId, { status: "cancelled" });
  await actions.staffCreateAppointment({ date: rDay, time: rTime, treatmentKey: "checkup", dentistId: naree.id, childName: "คืนนัด-2", guardianName: "x", phone: "0955555556", source: "phone" });
  threw = false;
  try { await actions.staffUpdateAppointment(firstId, { status: "confirmed" }); } catch { threw = true; }
  ok("restoring a cancelled booking into a taken time is refused", threw);
  const atSlot = (await queries.listAppointmentsBetween(rDay, rDay)).filter((a) => a.time === rTime && a.dentistSlug === "onanong" && a.status !== "cancelled");
  ok("…the dentist still has one booking at that time", atSlot.length === 1);
  for (const a of await queries.listAppointmentsBetween(rDay, rDay)) {
    if (a.childName.startsWith("คืนนัด")) await actions.staffDeleteAppointment(a.id);
  }

  console.log("\n— 13. One hold at a time per family —");
  const { day: hDay } = await bookable(addDays(today, 3), "checkup", naree.id, "onanong");
  const hTimes = [...new Set((await queries.slotsForDate(hDay)).filter((x) => !x.taken && x.dentistSlug === "onanong").map((x) => x.time))].sort();
  const h1 = await actions.holdSlot({ date: hDay, time: hTimes[0], treatmentKey: "checkup", dentistId: naree.id, ageGroup: "kid", lineIdToken: "e2e-hold-fam" });
  const h2 = await actions.holdSlot({ date: hDay, time: hTimes[1], treatmentKey: "checkup", dentistId: naree.id, ageGroup: "kid", lineIdToken: "e2e-hold-fam" });
  ok("a family can hold a time", h1.ok && h2.ok);
  const heldNow = (await queries.slotsForDate(hDay)).filter((x) => x.dentistSlug === "onanong" && x.taken).map((x) => x.time);
  ok("holding another time lets the first one go", !heldNow.includes(hTimes[0]) && heldNow.includes(hTimes[1]), heldNow.join(","));
  const other = await actions.holdSlot({ date: hDay, time: hTimes[0], treatmentKey: "checkup", dentistId: naree.id, ageGroup: "kid", lineIdToken: "e2e-hold-other" });
  ok("…so another family can hold it", other.ok);
  for (const t of [h2.token, other.token]) if (t) await actions.releaseSlotHold(t);

  console.log("\n— 14. History is kept for every change —");
  {
    const { visitEvent, bookingAttempt } = await import("../src/db/schema");
    const { asc, and, eq: heq } = await import("drizzle-orm");
    const eventsFor = (where: ReturnType<typeof heq>) => ndb.select().from(visitEvent).where(where).orderBy(asc(visitEvent.id));

    // section 1's booking: booked online → dentist assigned by staff → cancelled by the family
    const ev = await eventsFor(heq(visitEvent.appointmentId, onStaff!.id));
    const kinds = ev.map((e) => `${e.kind}:${e.actor}`);
    ok("online booking → history says booked by the family", kinds[0] === "booked:family", kinds.join(" "));
    const assign = ev.find((e) => e.kind === "dentist");
    ok("…dentist assigned by staff, from none", assign?.actor === "staff" && assign.prevDentistId === null && assign.dentistId === dentistId);
    const cancel = ev.find((e) => e.kind === "status" && e.status === "cancelled");
    ok("…cancelled by the family, from confirmed", cancel?.actor === "family" && cancel.prevStatus === "confirmed");

    // the walk-in from section 6: arrived → in chair → done → removed
    const wk = (await eventsFor(heq(visitEvent.waitlistId, entry!.id))).map((e) => `${e.kind}:${e.prevStatus}>${e.status}`).join(" ");
    ok(
      "walk-in: arrived, in the chair, done, removed — each step with the one before",
      wk === "walkin:>waiting status:waiting>in_chair status:in_chair>done deleted:done>",
      wk,
    );

    // section 12's deleted bookings keep a line with their ref
    const gone = await ndb.select().from(visitEvent).where(and(heq(visitEvent.ref, first ?? ""), heq(visitEvent.kind, "deleted")));
    ok("a deleted booking leaves a history line with its ref", gone.length === 1 && gone[0].prevStatus === "cancelled");

    // demand: a pick that became a booking, then the family moves it
    const { day: mDay, time: mTime } = await bookable(addDays(today, 2), "checkup", naree.id, "onanong");
    const mHold = await actions.holdSlot({ date: mDay, time: mTime, treatmentKey: "checkup", dentistId: naree.id, ageGroup: "kid", lineIdToken: "e2e-history" });
    const mBook = await actions.bookAppointment({
      date: mDay, time: mTime, treatmentKey: "checkup", dentistId: naree.id, ageGroup: "kid",
      childName: "ประวัติ", phone: "0966666666", lineIdToken: "e2e-history", holdToken: mHold.token,
    });
    ok("history test booking made", mBook.ok, JSON.stringify(mBook));
    const mId = (await queries.listAppointmentsBetween(mDay, mDay)).find((a) => a.ref === mBook.ref)!.id;
    const att = await ndb.select().from(bookingAttempt).where(heq(bookingAttempt.appointmentId, mId));
    ok("the website pick is logged and marked booked", att.length === 1 && att[0].outcome === "booked" && att[0].purpose === "new");
    const nextTime = (await queries.slotsForDate(mDay)).filter((x) => !x.taken && x.dentistSlug === "onanong" && x.time > mTime).map((x) => x.time).sort()[0];
    if (nextTime) {
      const moved = await actions.rescheduleBooking({ ref: mBook.ref!, lineIdToken: "e2e-history", date: mDay, time: nextTime });
      const mv = (await eventsFor(heq(visitEvent.appointmentId, mId))).find((e) => e.kind === "moved");
      ok("a move keeps where it was moved from", moved.ok && mv?.prevTime === mTime && mv.time === nextTime && mv.actor === "family");
    }
    await actions.staffSetQueueStatus(mId, "arrived");
    const arrived = (await eventsFor(heq(visitEvent.appointmentId, mId))).at(-1);
    ok("check-in at the desk is a timed history line", arrived?.kind === "status" && arrived.status === "arrived" && arrived.actor === "staff");
    const refused = await ndb.select().from(bookingAttempt).where(and(heq(bookingAttempt.date, far), heq(bookingAttempt.lineUserId, "")));
    ok("a time that couldn't be held is logged with the reason", refused.some((r) => r.outcome !== "held"));
    await queries.deleteAppointment(mId);
  }

  await actions.staffUpdateBookingRules(rulesBefore);

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
