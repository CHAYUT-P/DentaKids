import { test } from "node:test";
import assert from "node:assert/strict";

import { dayGrid } from "./staffAvailability";

// clinic 10:00–13:00; naree works 10:00–12:00, piya not that weekday
const base = {
  date: "2026-11-04",
  today: "2026-11-01",
  nowMin: 9 * 60,
  durationMin: 30,
  clinic: { isOpen: true, start: "10:00", end: "13:00" },
  holiday: false,
  weekday: 3,
  dentists: [
    { slug: "naree", name: "นรี", shifts: [{ weekday: 3, enabled: true, start: "10:00", end: "12:00" }], onLeave: false },
    { slug: "piya", name: "ปิยะ", shifts: [], onLeave: false },
  ],
  appointments: [{ id: "1", dentistSlug: "naree", time: "10:30", durationMin: 30, status: "confirmed", childName: "น้องเอ" }],
};
const col = (g: ReturnType<typeof dayGrid>, slug: string) => g.columns.find((c) => c.slug === slug)!;

test("a closed day or a holiday has no times", () => {
  assert.equal(dayGrid({ ...base, clinic: { ...base.clinic, isOpen: false } }).open, false);
  assert.equal(dayGrid({ ...base, holiday: true }).times.length, 0);
});

test("rows cover the clinic's opening hours", () => {
  assert.deepEqual(dayGrid(base).times, ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("a booking blocks its time; free and off-shift times are told apart", () => {
  const n = col(dayGrid(base), "naree");
  assert.deepEqual(n.cells["10:30"], { state: "booked", label: "น้องเอ" });
  assert.equal(n.cells["10:00"].state, "free");
  assert.equal(n.cells["12:30"].state, "offshift"); // clinic open, shift over: staff may still book
  assert.equal(col(dayGrid(base), "piya").cells["10:00"].state, "offshift");
});

test("a 1-hour treatment can't start where it would run into a booking or past closing", () => {
  const n = col(dayGrid({ ...base, durationMin: 60 }), "naree");
  assert.equal(n.cells["10:00"].state, "blocked"); // 10:30 is taken
  assert.equal(n.cells["11:00"].state, "free");
  assert.equal(n.cells["12:30"].state, "blocked"); // would end 13:30, after closing
});

test("a longer booking shows on every half-hour it runs", () => {
  const g = dayGrid({ ...base, appointments: [{ ...base.appointments[0], durationMin: 60 }] });
  assert.equal(col(g, "naree").cells["11:00"].state, "cont");
});

test("leave closes the dentist's column; past times today are gone", () => {
  const leave = dayGrid({ ...base, dentists: [{ ...base.dentists[0], onLeave: true }] });
  assert.equal(col(leave, "naree").cells["10:00"].state, "blocked");
  const today = dayGrid({ ...base, today: base.date, nowMin: 11 * 60 + 10 });
  assert.equal(col(today, "naree").cells["11:00"].state, "past");
  assert.equal(col(today, "naree").cells["11:30"].state, "free");
});

test("moving a booking: its own time shows as 'self' and doesn't block it", () => {
  const g = dayGrid({ ...base, durationMin: 60, excludeId: "1" });
  assert.equal(col(g, "naree").cells["10:30"].state, "self");
  assert.equal(col(g, "naree").cells["10:00"].state, "free"); // 10:00–11:00 overlaps only itself
});

test("dentists on shift come first; the day strip counts free in-shift times", () => {
  const g = dayGrid(base);
  assert.equal(g.columns[0].slug, "naree");
  assert.equal(g.freeCount, 3); // naree 10:00, 11:00, 11:30
});
