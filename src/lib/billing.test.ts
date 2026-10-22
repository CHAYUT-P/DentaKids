import { test } from "node:test";
import assert from "node:assert/strict";

import { billTotals, computeDf, lineNet, pickDfRule, type DfRule } from "./billing";

/** a bill line with only what the maths reads */
const line = (o: Partial<{ qty: number; unitPrice: number; discount: number; labCost: number; dentistSlug: string | null; treatmentKey: string | null }>) => ({
  qty: 1, unitPrice: 0, discount: 0, labCost: 0, dentistSlug: "naree", treatmentKey: "filling", ...o,
});
const rule = (o: Partial<DfRule>): DfRule => ({ id: 1, dentistSlug: null, treatmentKey: null, mode: "percent", value: 0, ...o });

test("a line is qty × price minus its discount, never below zero", () => {
  assert.equal(lineNet(line({ qty: 2, unitPrice: 500, discount: 100 })), 900);
  assert.equal(lineNet(line({ qty: 1, unitPrice: 300, discount: 999 })), 0);
  // bad input (negative, fractional, text) can't produce negative money
  assert.equal(lineNet(line({ qty: -3, unitPrice: 500 })), 0);
  assert.equal(lineNet(line({ qty: 1.4, unitPrice: 99.6 })), 100);
});

test("bill totals: subtotal of lines, bill discount off the top, never negative", () => {
  const items = [line({ unitPrice: 600 }), line({ unitPrice: 400, discount: 50 })];
  assert.deepEqual(billTotals(items, 100), { subtotal: 950, total: 850 });
  assert.deepEqual(billTotals(items, 5000), { subtotal: 950, total: 0 });
  assert.deepEqual(billTotals([], 0), { subtotal: 0, total: 0 });
});

test("DF rule: the most specific rule wins", () => {
  const rules = [
    rule({ id: 1, value: 10 }), // clinic default
    rule({ id: 2, dentistSlug: "naree", value: 20 }), // this dentist, any treatment
    rule({ id: 3, treatmentKey: "filling", value: 30 }), // this treatment, any dentist
    rule({ id: 4, dentistSlug: "naree", treatmentKey: "filling", value: 40 }), // both
  ];
  assert.equal(pickDfRule(rules, "naree", "filling")?.id, 4);
  assert.equal(pickDfRule(rules, "piya", "filling")?.id, 3);
  assert.equal(pickDfRule(rules, "naree", "crown")?.id, 2);
  assert.equal(pickDfRule(rules, "piya", "crown")?.id, 1);
  assert.equal(pickDfRule([], "naree", "filling"), undefined);
});

test("DF %: comes off the line after its share of the bill discount and the lab cost", () => {
  // 1,000 line, lab 200, 40% → (1000 − 200) × 40% = 320
  assert.deepEqual(computeDf([line({ unitPrice: 1000, labCost: 200 })], 0, [rule({ value: 40 })]), [320]);
  // a 100 bill discount is shared 60/40 by line value before the %
  const two = [line({ unitPrice: 600 }), line({ unitPrice: 400 })];
  assert.deepEqual(computeDf(two, 100, [rule({ value: 50 })]), [270, 180]);
});

test("DF fixed: baht per unit, whatever the price", () => {
  assert.deepEqual(computeDf([line({ qty: 3, unitPrice: 50 })], 0, [rule({ mode: "fixed", value: 200 })]), [600]);
});

test("DF: no dentist on the line, or no rule, earns nothing; DF never negative", () => {
  assert.deepEqual(computeDf([line({ unitPrice: 1000, dentistSlug: null })], 0, [rule({ value: 50 })]), [0]);
  assert.deepEqual(computeDf([line({ unitPrice: 1000 })], 0, []), [0]);
  // lab cost bigger than the line → base 0, not a negative fee
  assert.deepEqual(computeDf([line({ unitPrice: 300, labCost: 800 })], 0, [rule({ value: 50 })]), [0]);
  // a bill discount bigger than the bill is capped at the bill
  assert.deepEqual(computeDf([line({ unitPrice: 500 })], 9999, [rule({ value: 50 })]), [0]);
});
