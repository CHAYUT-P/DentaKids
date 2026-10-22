import { test } from "node:test";
import assert from "node:assert/strict";

import { bahtText } from "./bahtText";

test("receipt amounts in Thai words", () => {
  const cases: [number, string][] = [
    [0, "ศูนย์บาทถ้วน"],
    [1, "หนึ่งบาทถ้วน"],
    [11, "สิบเอ็ดบาทถ้วน"],
    [21, "ยี่สิบเอ็ดบาทถ้วน"],
    [101, "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [1250, "หนึ่งพันสองร้อยห้าสิบบาทถ้วน"],
    [100000, "หนึ่งแสนบาทถ้วน"],
    [1000000, "หนึ่งล้านบาทถ้วน"],
    [2100021, "สองล้านหนึ่งแสนยี่สิบเอ็ดบาทถ้วน"],
    [11000000, "สิบเอ็ดล้านบาทถ้วน"],
  ];
  for (const [n, words] of cases) assert.equal(bahtText(n), words, `${n}`);
});

test("rounds to whole baht and never goes negative", () => {
  assert.equal(bahtText(99.6), "หนึ่งร้อยบาทถ้วน");
  assert.equal(bahtText(-50), "ศูนย์บาทถ้วน");
});
