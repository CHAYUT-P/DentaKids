/**
 * Concurrency test — fires many requests at the same moment through the same
 * server code the website and staff app call, then counts what landed in
 * Postgres. Proves the guarantees in docs/design/01-no-double-booking.md:
 *
 *   1. one dentist, one time, N families at once      → exactly 1 booking
 *   2. "any dentist", N families, C chairs             → exactly C bookings
 *   3. 1-hour and 30-minute bookings racing to overlap → never overlap
 *   4. the same booking sent N times at once (one key) → 1 booking, N "ok"
 *   5. N payments racing on one bill                   → never more than owed
 *   6. the same payment sent N times (one key)         → recorded once
 *   7. two bills spending one deposit at once          → only one succeeds
 *
 * Run: pnpm concurrency:test   (local database only — it creates and then
 * removes its own bookings, bills and deposit)
 */
import "dotenv/config";

const N = Number(process.env.N ?? 30);

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    console.error("Refusing to run: DATABASE_URL is not a local database.");
    process.exit(1);
  }
  // patient identity without real LINE (dev stand-in); no LINE messages go out
  delete process.env.LINE_LOGIN_CHANNEL_ID;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const actions = await import("../src/server/actions");
  const queries = await import("../src/server/queries");
  const billing = await import("../src/server/billing");
  const { db } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { todayISO, addDays, minutesOf } = await import("../src/lib/dates");
  const { coveredTimes } = await import("../src/lib/slots");

  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    if (cond) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };
  const key = () => crypto.randomUUID();
  /** this run's own tag, so leftovers from earlier runs never count */
  const RUN = Date.now().toString(36).slice(-5);
  const FAMILY = "concurrency-test";
  const madeRefs: string[] = [];
  const timed = async <T>(label: string, fn: () => Promise<T>) => {
    const t0 = performance.now();
    const r = await fn();
    console.log(`    (${label}: ${Math.round(performance.now() - t0)} ms)`);
    return r;
  };

  // a day and time where `dentistId` has `run` free half-hours in a row
  const today = todayISO();
  async function freeRun(dentistId: number, run: number, startOffset: number) {
    for (let k = startOffset; k < startOffset + 40; k++) {
      const date = addDays(today, k);
      const rows = (await queries.slotsForDate(date))
        .filter((r) => r.dentistId === dentistId)
        .sort((a, b) => (a.time < b.time ? -1 : 1));
      for (let n = 0; n + run - 1 < rows.length; n++) {
        const seq = rows.slice(n, n + run);
        const steps = seq.every((r, q) => q === 0 || minutesOf(r.time) - minutesOf(seq[q - 1].time) === 30);
        if (steps && seq.every((r) => !r.taken)) return { date, times: seq.map((r) => r.time) };
      }
    }
    throw new Error("no free run found");
  }

  const dentists = (await queries.listDentists()).filter((d) => d.isActive);
  const doc = dentists.find((d) => d.treats.includes("checkup"))!;

  console.log(`\n— 1. ${N} families, one dentist, one time —`);
  {
    const { date, times } = await freeRun(doc.id, 1, 3);
    const results = await timed(`${N} at once`, () =>
      Promise.all(
        Array.from({ length: N }, (_, i) =>
          actions.bookAppointment({ ageGroup: "kid",
            date, time: times[0], treatmentKey: "checkup", dentistId: doc.id,
            childName: `ชน${i}`, phone: "0900000000", lineIdToken: FAMILY, idempotencyKey: key(),
          }),
        ),
      ),
    );
    const wins = results.filter((r) => r.ok);
    wins.forEach((w) => madeRefs.push(w.ref!));
    ok(`exactly 1 of ${N} succeeds`, wins.length === 1, `${wins.length} succeeded`);
    const rows = (await queries.listAppointmentsBetween(date, date)).filter(
      (a) => a.dentistId === doc.id && a.time === times[0] && a.status !== "cancelled",
    );
    ok("exactly 1 row in the database", rows.length === 1, `${rows.length} rows`);
  }

  console.log(`\n— 2. ${N} "any dentist" bookings, limited chairs —`);
  {
    const chairsBefore = await queries.getChairs();
    const CHAIRS = 2;
    await queries.setChairs(CHAIRS);
    try {
      const { date, times } = await freeRun(doc.id, 1, 6);
      const busyBefore = (await queries.liveAtSlot(date, times[0])).length;
      const room = Math.max(0, CHAIRS - busyBefore);
      const results = await timed(`${N} at once`, () =>
        Promise.all(
          Array.from({ length: N }, (_, i) =>
            actions.bookAppointment({ ageGroup: "kid",
              date, time: times[0], treatmentKey: "checkup", dentistId: null,
              childName: `พูล${i}`, phone: "0900000001", lineIdToken: FAMILY, idempotencyKey: key(),
            }),
          ),
        ),
      );
      const wins = results.filter((r) => r.ok);
      wins.forEach((w) => madeRefs.push(w.ref!));
      ok(`exactly ${room} of ${N} succeed (${CHAIRS} chairs)`, wins.length === room, `${wins.length} succeeded`);
      const live = (await queries.liveAtSlot(date, times[0])).length;
      ok(`never more than ${CHAIRS} in the chairs at ${times[0]}`, live <= CHAIRS, `${live} live`);
    } finally {
      await queries.setChairs(chairsBefore);
    }
  }

  console.log("\n— 3. 1-hour and 30-minute bookings racing to overlap —");
  {
    const before = (await queries.listTreatmentCatalog()).find((t) => t.key === "whitening")!;
    await actions.staffUpdateTreatment("whitening", { durationMin: 60 });
    const whiteDoc = dentists.find((d) => d.treats.includes("whitening")) ?? doc;
    const { date, times } = await freeRun(whiteDoc.id, 3, 9);
    const [a, b] = times;
    const results = await timed(`${N} mixed at once`, () =>
      Promise.all(
        Array.from({ length: N }, (_, i) =>
          actions.bookAppointment(
            i % 2 === 0
              ? { date, time: a, treatmentKey: "whitening", dentistId: whiteDoc.id, childName: `ยาว${i}`,
                  phone: "0900000002", ageGroup: "adult", lineIdToken: FAMILY, idempotencyKey: key() }
              : { date, time: b, treatmentKey: "checkup", dentistId: whiteDoc.id, childName: `สั้น${i}`,
                  phone: "0900000003", lineIdToken: FAMILY, idempotencyKey: key() },
          ),
        ),
      ),
    );
    results.filter((r) => r.ok).forEach((w) => madeRefs.push(w.ref!));
    const rows = (await queries.listAppointmentsBetween(date, date)).filter(
      (x) => x.dentistId === whiteDoc.id && x.status !== "cancelled",
    );
    const seen = new Map<string, number>();
    for (const r of rows) for (const t of coveredTimes(r.time, r.durationMin)) seen.set(t, (seen.get(t) ?? 0) + 1);
    const clash = [...seen.values()].some((n) => n > 1);
    ok("no two bookings share a half-hour", !clash, JSON.stringify(Object.fromEntries(seen)));
    await actions.staffUpdateTreatment("whitening", { durationMin: before.durationMin });
  }

  console.log(`\n— 4. the same booking sent ${N} times at once (one key) —`);
  {
    const { date, times } = await freeRun(doc.id, 1, 12);
    const k = key();
    const results = await timed(`${N} copies`, () =>
      Promise.all(
        Array.from({ length: N }, () =>
          actions.bookAppointment({ ageGroup: "kid",
            date, time: times[0], treatmentKey: "checkup", dentistId: doc.id,
            childName: `ซ้ำ-${RUN}`, phone: "0900000004", lineIdToken: FAMILY, idempotencyKey: k,
          }),
        ),
      ),
    );
    const refs = new Set(results.filter((r) => r.ok).map((r) => r.ref));
    refs.forEach((r) => madeRefs.push(r!));
    ok(`all ${N} answered "booked"`, results.every((r) => r.ok), `${results.filter((r) => !r.ok).length} refused`);
    ok("…all with the same booking code", refs.size === 1, [...refs].join(","));
    const rows = (await queries.listAppointmentsBetween(date, date)).filter((x) => x.childName === `ซ้ำ-${RUN}`);
    ok("exactly 1 row in the database", rows.length === 1, `${rows.length} rows`);
    const retry = await actions.bookAppointment({ ageGroup: "kid",
      date, time: times[0], treatmentKey: "checkup", dentistId: doc.id,
      childName: `ซ้ำ-${RUN}`, phone: "0900000004", lineIdToken: FAMILY, idempotencyKey: k,
    });
    ok("a later retry gets the same booking", retry.ok && retry.ref === [...refs][0]);
  }

  console.log("\n— 5–7. payments —");
  const billIds: number[] = [];
  let childId: number | null = null;
  try {
    const bill = async (total: number, withChild?: number) => {
      const id = await billing.openBlankBill({ patientName: "ทดสอบชำระ", phone: "0900000005", childId: withChild ?? null });
      billIds.push(id);
      await billing.saveBill(id, {
        items: [{ treatmentKey: null, name: "ทดสอบ", teeth: "", qty: 1, unitPrice: total, discount: 0, labCost: 0, dentistSlug: null, df: 0 }],
        discount: 0,
        note: "",
      });
      return id;
    };

    // 5. N cashiers each try to take the whole amount at once
    const b1 = await bill(1000);
    const r5 = await timed(`${N} payments`, () =>
      Promise.all(Array.from({ length: N }, () => billing.addPayment(b1, { method: "cash", amount: 1000, idempotencyKey: key() }))),
    );
    const paid5 = (await db.select().from(schema.payment).where(eq(schema.payment.invoiceId, b1))).reduce((s, p) => s + p.amount, 0);
    ok(`1 of ${N} payments goes through`, r5.filter((r) => r.ok).length === 1, `${r5.filter((r) => r.ok).length} ok`);
    ok("bill paid exactly 1,000 — never more than owed", paid5 === 1000, `paid ${paid5}`);

    // 6. one payment, double-clicked N times (same key)
    const b2 = await bill(800);
    const k6 = key();
    const r6 = await Promise.all(Array.from({ length: N }, () => billing.addPayment(b2, { method: "cash", amount: 300, idempotencyKey: k6 })));
    const rows6 = await db.select().from(schema.payment).where(eq(schema.payment.invoiceId, b2));
    ok(`all ${N} clicks answered ok`, r6.every((r) => r.ok));
    ok("the money is recorded once", rows6.length === 1 && rows6[0].amount === 300, `${rows6.length} rows`);

    // 7. a 500 deposit, two bills of 500 spending it at the same moment
    const [kid] = await db.select({ id: schema.child.id }).from(schema.child).limit(1);
    childId = kid.id;
    const { creditBalance } = await import("../src/server/clinical");
    const startCredit = await creditBalance(childId);
    await db.insert(schema.patientCredit).values({ childId, amount: 500 - startCredit, note: "ทดสอบมัดจำ" });
    const [b3, b4] = [await bill(500, childId), await bill(500, childId)];
    const r7 = await Promise.all([
      billing.addPayment(b3, { method: "credit", amount: 500, idempotencyKey: key() }),
      billing.addPayment(b4, { method: "credit", amount: 500, idempotencyKey: key() }),
    ]);
    const left = await creditBalance(childId);
    ok("only one bill can spend the deposit", r7.filter((r) => r.ok).length === 1, `${r7.filter((r) => r.ok).length} ok`);
    ok("deposit never goes negative", left === 0, `left ${left}`);
  } finally {
    // tidy up: this test's bills, payments and deposit rows
    if (billIds.length) {
      await db.delete(schema.patientCredit).where(inArray(schema.patientCredit.invoiceId, billIds));
      await db.delete(schema.invoice).where(inArray(schema.invoice.id, billIds));
    }
    if (childId !== null) {
      const { and, isNull, like } = await import("drizzle-orm");
      await db
        .delete(schema.patientCredit)
        .where(and(eq(schema.patientCredit.childId, childId), isNull(schema.patientCredit.invoiceId), like(schema.patientCredit.note, "ทดสอบมัดจำ")));
    }
  }

  // tidy up: cancel every booking this test made
  for (const ref of new Set(madeRefs)) await actions.cancelBooking(ref, FAMILY);

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
