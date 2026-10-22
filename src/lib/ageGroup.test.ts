import { test } from "node:test";
import assert from "node:assert/strict";

import { agesAllow } from "./ageGroup";

test("kids / adults / both", () => {
  assert.equal(agesAllow("kids", "kid"), true);
  assert.equal(agesAllow("kids", "adult"), false);
  assert.equal(agesAllow("adults", "kid"), false);
  assert.equal(agesAllow("both", "adult"), true);
  // not set, or nobody asked (older and staff bookings): allowed
  assert.equal(agesAllow(undefined, "adult"), true);
  assert.equal(agesAllow("kids", null), true);
});
