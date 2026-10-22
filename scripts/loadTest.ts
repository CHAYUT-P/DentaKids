/**
 * HTTP load test runner (docs/design/05-load-test.md). Start a production
 * build on a LOCAL test database with LINE switched off, then:
 *
 *   pnpm build
 *   PORT=3002 DATABASE_URL=<local db> LINE_LOGIN_CHANNEL_ID= LINE_CHANNEL_ACCESS_TOKEN= pnpm start
 *   DATABASE_URL=<same local db> pnpm load:test same_slot|any_slot|journey|same_ip|steady|stress   (steady: RATE=50)
 *
 * It clears earlier k6 bookings, runs scripts/load/booking.js in Docker
 * (grafana/k6), then checks Postgres: nobody double-booked, chairs never
 * over-filled, every "booked" answer is a real row.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const K6_IMAGE = "grafana/k6:1.0.0";
const scenario = process.argv[2] ?? "journey";
const url = process.env.DATABASE_URL ?? "";
const BASE = process.env.BASE ?? "http://host.docker.internal:3002";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not a local database.");
  process.exit(1);
}
if (!["same_slot", "any_slot", "journey", "same_ip", "steady", "stress"].includes(scenario)) {
  console.error(`Unknown scenario "${scenario}"`);
  process.exit(1);
}

const sql = postgres(url, { max: 2, onnotice: () => {} });
const DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

async function main() {
  // the build's ids for the two actions the booking page calls
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8"));
  const idOf = (name: string) =>
    Object.entries(manifest.node as Record<string, { exportedName?: string }>).find(([, v]) => v.exportedName === name)?.[0];
  const HOLD_ACTION = idOf("holdSlot");
  const BOOK_ACTION = idOf("bookAppointment");
  if (!HOLD_ACTION || !BOOK_ACTION) throw new Error("no action ids in .next — run pnpm build first");

  // clean slate: earlier k6 bookings, holds, and the k6 addresses' rate limits
  await sql`delete from appointment where child_name like 'k6 %'`;
  await sql`delete from slot_hold where date >= ${iso(plusDays(0))}`;
  await sql`delete from rate_limit where key like 'book:10.%' or key like 'hold:10.%'`;

  // contested slot: the next day dentist 1 works, 14:00
  const shifts = await sql`select weekday from dentist_shift where dentist_id = 1 and enabled`;
  const works = new Set(shifts.map((s) => Number(s.weekday)));
  let date = "";
  for (let i = 2; i < 30 && !date; i++) if (works.has(plusDays(i).getUTCDay())) date = iso(plusDays(i));
  const open = new Set((await sql`select day from clinic_day where is_open`).map((r) => r.day as string));
  const days = Array.from({ length: 13 }, (_, i) => plusDays(i + 1)).filter((d) => open.has(DAY[d.getUTCDay()])).map(iso);
  const [{ value: chairs }] = await sql`select coalesce((select value from clinic_setting where key = 'chairs'), '3') as value`;

  const RUN = Date.now().toString(36);
  console.log(`Scenario ${scenario} · contested slot ${date} 14:00 · ${chairs} chairs · run ${RUN}\n`);

  const env = { RATE: process.env.RATE ?? "50", BASE, HOLD_ACTION, BOOK_ACTION, SCENARIO: scenario, RUN, DATE: date, TIME: "14:00", DENTIST: "1", DAYS: days.join(",") };
  const k6 = spawnSync(
    "docker",
    [
      "run", "--rm", "-i",
      ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      "-v", `${process.cwd()}/scripts/load:/scripts:ro`,
      K6_IMAGE, "run", "--quiet", "/scripts/booking.js",
    ],
    { stdio: "inherit" },
  );

  // what actually landed in Postgres
  const rows = await sql`
    select dentist_id, date, time, duration_min from appointment
    where child_name like ${`k6 ${RUN} %`} and status <> 'cancelled'`;
  const overlaps = await sql`
    select count(*)::int as n from appointment a join appointment b
      on a.id < b.id and a.dentist_id = b.dentist_id and a.date = b.date
     and a.status <> 'cancelled' and b.status <> 'cancelled'
     and a.time::time < b.time::time + make_interval(mins => b.duration_min)
     and b.time::time < a.time::time + make_interval(mins => a.duration_min)
    where a.date >= ${iso(plusDays(0))}`;
  const busiest = await sql`
    select date, time, count(*)::int as n from appointment
    where date >= ${iso(plusDays(0))} and status <> 'cancelled'
    group by date, time order by n desc limit 1`;

  console.log("\nDatabase check");
  console.log(`  bookings saved by this run : ${rows.length}`);
  console.log(`  dentist double-bookings    : ${overlaps[0].n}  (must be 0)`);
  if (busiest.length) {
    console.log(`  most bookings in one slot   : ${busiest[0].n} at ${busiest[0].date} ${busiest[0].time}  (must be ≤ ${chairs})`);
  }
  if (scenario === "same_slot") console.log(`  bookings in the contested slot: ${rows.length}  (must be 1)`);
  if (scenario === "same_ip") console.log(`  bookings from one address  : ${rows.length}  (must be ≤ 20)`);
  if (scenario === "any_slot") console.log(`  bookings in the contested slot: ${rows.length}  (must be ≤ ${chairs})`);

  const bad =
    overlaps[0].n > 0 ||
    (busiest.length > 0 && busiest[0].n > Number(chairs)) ||
    (scenario === "same_slot" && rows.length !== 1) ||
    (scenario === "any_slot" && rows.length > Number(chairs)) ||
    (scenario === "same_ip" && rows.length > 20);
  await sql.end();
  if (bad) {
    console.log("\n✗ database check FAILED");
    process.exit(1);
  }
  console.log("\n✓ database check passed");
  process.exit(k6.status ?? 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
