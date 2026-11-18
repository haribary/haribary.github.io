import test from "node:test";
import assert from "node:assert/strict";
import { cleanName } from "../src/names.mjs";

// The blocked words are kept in ROT13 here too, as they are in names.mjs.
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

test("ordinary names pass and are tidied", () => {
  for (const [raw, shown] of [
    ["Ada", "Ada"], ["  ada   lovelace ", "ada lovelace"], ["José", "José"], ["李小龙", "李小龙"],
    ["O'Brien", "O'Brien"], ["jean-luc", "jean-luc"], ["gpu_enjoyer.99", "gpu_enjoyer.99"], ["x".repeat(16), "x".repeat(16)],
  ]) assert.deepEqual(cleanName(raw), { ok: true, name: shown }, raw);
  // a decomposed accent is one character once composed
  assert.deepEqual(cleanName("José"), { ok: true, name: "José" });
});

test("empty, long and odd names are refused with the reason", () => {
  assert.equal(cleanName("").reason, "empty");
  assert.equal(cleanName("   ").reason, "empty");
  assert.equal(cleanName(undefined).reason, "empty");
  assert.equal(cleanName("x".repeat(17)).reason, "long");
  for (const raw of ["<b>hi</b>", "a@b.com", "two\nlines!", "🙂", "...", "- -", 7, {}]) assert.equal(cleanName(raw).reason, "invalid", String(raw));
});

test("blocked words are refused however they are dressed up", () => {
  const word = rot13("shpx"), whole = rot13("fuvg");
  for (const raw of [word, word.toUpperCase(), `x${word}x`, word.split("").join("."), word.replace("u", "uuu"), `${word}99`, word.replace("c", "cc")]) {
    assert.deepEqual(cleanName(raw), { ok: false, reason: "blocked" }, raw);
  }
  for (const raw of [whole, `${whole} ${whole}`, `big ${whole}`, whole.replace("i", "1"), whole.replace("s", "5")]) {
    assert.deepEqual(cleanName(raw), { ok: false, reason: "blocked" }, raw);
  }
});

test("ordinary names that contain a blocked word as a fragment still pass", () => {
  for (const raw of ["Kshitij", "Hancock", "Cassandra", "Nazir", "Grape Soda", "Van Dyke", "Nigeria", "Essex", "Dickinson", "Matsushita"]) {
    assert.equal(cleanName(raw).ok, true, raw);
  }
});
