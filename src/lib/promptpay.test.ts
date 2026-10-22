import { test } from "node:test";
import assert from "node:assert/strict";

import { crc16, promptPayPayload } from "./promptpay";

test("CRC-16/CCITT-FALSE matches the standard check value", () => {
  // the published check value for the ASCII string "123456789"
  assert.equal(crc16("123456789"), "29B1");
});

test("a phone number becomes a valid Thai QR payload with the amount", () => {
  const p = promptPayPayload("081-234-5678", 1250)!;
  assert.ok(p.includes("01130066812345678"), "phone in international form");
  assert.ok(p.includes("54071250.00"), "amount with two decimals");
  assert.ok(p.includes("5303764"), "currency THB");
  assert.ok(p.includes("010212"), "dynamic QR when an amount is set");
  // the last 4 characters are the checksum of everything before them
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
});

test("a 13-digit id works; anything else is refused", () => {
  assert.ok(promptPayPayload("1234567890123")?.includes("02131234567890123"));
  assert.equal(promptPayPayload("12345"), null);
  assert.equal(promptPayPayload("1812345678"), null); // 10 digits but not a 0x mobile
});
