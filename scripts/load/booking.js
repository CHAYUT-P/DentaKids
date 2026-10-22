/**
 * k6 load test of the real booking path families use: the /book page, then
 * the holdSlot and bookAppointment server actions, called over HTTP exactly
 * as the browser calls them (POST + Next-Action header). Run it through
 * `pnpm load:test <scenario>` (scripts/loadTest.ts), which supplies the
 * action ids from the build, resets the test bookings and checks the
 * database afterwards. docs/design/05-load-test.md
 *
 *   same_slot  200 families tap "book" for the same dentist, same time, at once
 *   any_slot   200 families book "any dentist" for the same time (3 chairs)
 *   journey    open the page → hold a time → book, ramping to 30 families/s
 *   steady     the journey at RATE families/s for 30 s
 *   stress     the journey at 50 → 400 families/s, to find the limit of one server
 *   same_ip    one address books 30 different free times (the limit is 20 per 10 min)
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE = __ENV.BASE || "http://host.docker.internal:3002";
const HOLD = __ENV.HOLD_ACTION;
const BOOK = __ENV.BOOK_ACTION;
const SCENARIO = __ENV.SCENARIO || "journey";
const RUN = __ENV.RUN || "run";
// the contested slot: a day dentist 1 works, in the test database
const DATE = __ENV.DATE || "2026-10-28";
const TIME = __ENV.TIME || "14:00";
const DENTIST = Number(__ENV.DENTIST || 1);
// journey: the open days ahead (passed in by the runner)
const DAYS = (__ENV.DAYS || DATE).split(",");
const TIMES = [];
for (let m = 9 * 60; m < 17 * 60; m += 30) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`);

export const booked = new Counter("booked");
export const refused = new Counter("refused");
export const pageMs = new Trend("page_book_ms", true);
export const holdMs = new Trend("action_hold_ms", true);
export const bookMs = new Trend("action_book_ms", true);

const scenarios = {
  same_slot: { executor: "per-vu-iterations", vus: 200, iterations: 1, maxDuration: "60s" },
  any_slot: { executor: "per-vu-iterations", vus: 200, iterations: 1, maxDuration: "60s" },
  same_ip: { executor: "per-vu-iterations", vus: 1, iterations: 30, maxDuration: "60s" },
  journey: {
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 100,
    maxVUs: 400,
    stages: [
      { target: 5, duration: "30s" }, // a normal busy evening
      { target: 30, duration: "30s" }, // the clinic sends a LINE promotion
      { target: 30, duration: "60s" },
      { target: 0, duration: "15s" },
    ],
  },
  // not a clinic scenario: RATE families/s for 30 s, to find where it bends
  steady: {
    executor: "constant-arrival-rate",
    rate: Number(__ENV.RATE || 50),
    timeUnit: "1s",
    duration: "30s",
    preAllocatedVUs: 200,
    maxVUs: 1000,
  },
  // not a clinic scenario: keeps raising the rate to find where one server slows down
  stress: {
    executor: "ramping-arrival-rate",
    startRate: 50,
    timeUnit: "1s",
    preAllocatedVUs: 200,
    maxVUs: 1000,
    stages: [
      { target: 100, duration: "30s" },
      { target: 200, duration: "30s" },
      { target: 400, duration: "30s" },
      { target: 0, duration: "10s" },
    ],
  },
};

export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: {
    // no request may fail at the HTTP level (a "slot taken" answer is a 200)
    http_req_failed: ["rate<0.01"],
    ...(SCENARIO === "journey" || SCENARIO === "steady" || SCENARIO === "stress"
      ? { page_book_ms: ["p(95)<1500"], action_hold_ms: ["p(95)<500"], action_book_ms: ["p(95)<800"] }
      : {}),
  },
  summaryTrendStats: ["med", "p(95)", "p(99)", "max"],
};

/** a server action call — the same request the browser's React makes */
function action(id, arg, ip) {
  return http.post(`${BASE}/book`, JSON.stringify([arg]), {
    headers: {
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      // each family is its own address (the rate limit is per address)
      "X-Forwarded-For": ip,
    },
    tags: { name: id === HOLD ? "holdSlot" : "bookAppointment" },
  });
}

/** the action's return value is the "1:" line of the response */
function result(res) {
  const line = (res.body || "").split("\n").find((l) => l.startsWith("1:"));
  try {
    return line ? JSON.parse(line.slice(2)) : null;
  } catch {
    return null;
  }
}

function family() {
  const n = exec.scenario.iterationInTest;
  const ip = SCENARIO === "same_ip" ? "10.200.0.1" : `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  return {
    ip,
    name: `k6 ${RUN} ${n}`,
    phone: `08${String(10000000 + n).slice(-8)}`,
    key: `k6-${RUN}-${SCENARIO}-${n}`,
  };
}

function book(f, slot, holdToken) {
  const res = action(
    BOOK,
    {
      ...slot,
      childName: f.name,
      phone: f.phone,
      ageGroup: "kid",
      holdToken,
      idempotencyKey: f.key,
    },
    f.ip,
  );
  bookMs.add(res.timings.duration);
  const r = result(res);
  check(res, { "booking answered": () => res.status === 200 && r !== null });
  if (r && r.ok) booked.add(1);
  else refused.add(1, { why: (r && r.error) || "none" });
  return r;
}

export default function visit() {
  const f = family();

  if (SCENARIO === "same_slot") {
    book(f, { date: DATE, time: TIME, treatmentKey: "checkup", dentistId: DENTIST });
    return;
  }
  if (SCENARIO === "same_ip") {
    // a different free time each go, so only the rate limit can say no
    const n = exec.scenario.iterationInTest;
    book(f, { date: DAYS[Math.floor(n / TIMES.length)], time: TIMES[n % TIMES.length], treatmentKey: "checkup", dentistId: null });
    return;
  }
  if (SCENARIO === "any_slot") {
    book(f, { date: DATE, time: TIME, treatmentKey: "checkup", dentistId: null });
    return;
  }

  // journey: open the booking page, pick a time, hold it, confirm
  const page = http.get(`${BASE}/book`, { headers: { "X-Forwarded-For": f.ip }, tags: { name: "GET /book" } });
  pageMs.add(page.timings.duration);
  check(page, { "page loads": (r) => r.status === 200 });

  const slot = {
    date: DAYS[Math.floor(Math.random() * DAYS.length)],
    time: TIMES[Math.floor(Math.random() * TIMES.length)],
    treatmentKey: "checkup",
    dentistId: null,
  };
  const holdRes = action(HOLD, { ...slot, ageGroup: "kid" }, f.ip);
  holdMs.add(holdRes.timings.duration);
  const hold = result(holdRes);
  check(holdRes, { "hold answered": () => holdRes.status === 200 && hold !== null });
  if (!hold || !hold.ok) {
    refused.add(1, { why: "hold" }); // that time is full — a real family would pick another
    return;
  }
  book(f, slot, hold.token);
}
