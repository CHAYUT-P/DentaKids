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
  const { todayISO, addDays, weekdayIndex } = await import("../src/lib/dates");

  const today = todayISO();
  let passed = 0, failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  console.log("\n— 1. Parent books online (new family) —");
  // find a day naree works, next week
  let date = addDays(today, 7);
  while (![1, 3, 5, 6].includes(weekdayIndex(date))) date = addDays(date, 1);

  // pick a slot no leftover run has taken, per dentist availability
  const allSlots = await (await import("../src/server/queries")).slotsForDate(date);
  const freeTimes = [...new Set(allSlots.filter((s) => !s.taken).map((s) => s.time))].sort();
  const time = freeTimes.find((t) => t >= "14:00") ?? freeTimes[0];
  console.log(`  (using ${date} at ${time})`);
  const result = await actions.bookAppointment({
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
  const clash = await actions.bookAppointment({
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
    // a dentist who does whitening, on a day they work with 09:30–11:00 free
    const doc = (await queries.listDentists()).find((d) => d.isActive && d.treats.includes("whitening"))!;
    let d3 = addDays(today, 9);
    const freeRun = async (iso: string) => {
      const rows = (await queries.slotsForDate(iso)).filter((r) => r.dentistId === doc.id);
      const free = (t: string) => rows.some((r) => r.time === t && !r.taken);
      return ["09:30", "10:00", "10:30", "11:00"].every(free);
    };
    while (!(await freeRun(d3))) d3 = addDays(d3, 1);
    const long = await actions.bookAppointment({
      date: d3, time: "10:00", treatmentKey: "whitening", dentistId: doc.id,
      childName: "ฟอกสีทดสอบ", phone: "0922222222", ageGroup: "adult", lineIdToken: FAMILY,
    });
    ok("1-hour booking at 10:00 accepted", long.ok, JSON.stringify(long));
    const grid = (await queries.slotsForDate(d3)).filter((r) => r.dentistId === doc.id);
    ok("10:00 and 10:30 both taken", ["10:00", "10:30"].every((t) => grid.find((r) => r.time === t)?.taken));
    ok("11:00 still free", grid.find((r) => r.time === "11:00")?.taken === false);
    const at1030 = await actions.bookAppointment({
      date: d3, time: "10:30", treatmentKey: "checkup", dentistId: doc.id,
      childName: "ชนครึ่งหลัง", phone: "0933333333", lineIdToken: FAMILY,
    });
    ok("10:30 refused (inside the 1-hour booking)", !at1030.ok);
    const at0930 = await actions.bookAppointment({
      date: d3, time: "09:30", treatmentKey: "whitening", dentistId: doc.id,
      childName: "ชนครึ่งแรก", phone: "0944444444", ageGroup: "adult", lineIdToken: FAMILY,
    });
    ok("1-hour at 09:30 refused (runs into 10:00)", !at0930.ok);
    const row = (await queries.listAppointmentsBetween(d3, d3)).find((a) => a.ref === long.ref);
    ok("booking stored as 60 minutes", row?.durationMin === 60);
    if (long.ok) await actions.cancelBooking(long.ref!, FAMILY);
    const freed = (await queries.slotsForDate(d3)).filter((r) => r.dentistId === doc.id);
    ok("cancelling frees both half-hours", ["10:00", "10:30"].every((t) => freed.find((r) => r.time === t)?.taken === false));
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

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
