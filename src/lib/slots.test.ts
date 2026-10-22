import { test } from "node:test";
import assert from "node:assert/strict";

import { coveredTimes, dentistDayTimes, durationTh, endTime, gridTimes, slotsNeeded, timeRange } from "./slots";

test("a booking holds every half-hour it runs into", () => {
  assert.deepEqual(coveredTimes("10:30", 30), ["10:30"]);
  assert.deepEqual(coveredTimes("10:30", 60), ["10:30", "11:00"]);
  assert.deepEqual(coveredTimes("11:30", 90), ["11:30", "12:00", "12:30"]);
  // anything shorter than a slot still takes one; 45 minutes takes two
  assert.equal(slotsNeeded(0), 1);
  assert.equal(slotsNeeded(45), 2);
});

test("end time and the range shown to families", () => {
  assert.equal(endTime("17:30", 60), "18:30");
  assert.equal(timeRange("10:00", 30), "10:00");
  assert.equal(timeRange("10:00", 60), "10:00–11:00");
  assert.equal(durationTh(60), "1 ชม.");
  assert.equal(durationTh(90), "1 ชม. 30 นาที");
});

test("the grid between two times", () => {
  assert.deepEqual(gridTimes("10:30", "12:00"), ["10:30", "11:00", "11:30"]);
  assert.deepEqual(gridTimes("10:00", "10:00"), []);
});

test("a dentist's bookable starts leave room for the whole treatment", () => {
  const shifts = [{ weekday: 2, enabled: true, start: "10:30", end: "19:00" }, { weekday: 1, enabled: false, start: "10:30", end: "19:00" }];
  const half = dentistDayTimes(shifts, 2, 30);
  assert.equal(half[0], "10:30");
  assert.equal(half.at(-1), "18:30");
  assert.equal(dentistDayTimes(shifts, 2, 60).at(-1), "18:00"); // 1 hour must finish by 19:00
  assert.deepEqual(dentistDayTimes(shifts, 1), []); // Monday off
  assert.deepEqual(dentistDayTimes(shifts, 3), []); // no shift at all
});
