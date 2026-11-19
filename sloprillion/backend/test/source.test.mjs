import test from "node:test";
import assert from "node:assert/strict";
import { cleanSource, visitSource } from "../../src/source.js";

const HOME = { host: "haribary.github.io", path: "/sloprillion/" };
const from = (referrer, search = "") => visitSource({ ...HOME, referrer, search });

test("a ?ref= tag wins over the referrer", () => {
  assert.equal(from("https://www.google.com/", "?ref=discord"), "discord");
  assert.equal(from("", "?ref=X"), "x");
  assert.equal(from("", "?day=2&ref=hn-launch"), "hn-launch");
});

test("a malformed tag is ignored, not recorded", () => {
  assert.equal(from("", "?ref=has%20space"), "direct");
  assert.equal(from("https://example.com/", "?ref=%3Cscript%3E"), "example.com");
  assert.equal(from("", "?ref=" + "a".repeat(41)), "direct");
  assert.equal(from("", "?ref="), "direct");
});

test("the referring site is its host name, without www", () => {
  assert.equal(from("https://www.google.com/search?q=sloprillion"), "google.com");
  assert.equal(from("https://news.ycombinator.com/item?id=1"), "news.ycombinator.com");
  assert.equal(from("android-app://com.slack/"), "com.slack");
});

test("shorteners and redirect hosts fold into their site", () => {
  assert.equal(from("https://t.co/abc123"), "x.com");
  assert.equal(from("https://twitter.com/someone"), "x.com");
  assert.equal(from("https://l.instagram.com/?u=..."), "instagram.com");
  assert.equal(from("https://lnkd.in/abc"), "linkedin.com");
  assert.equal(from("https://out.reddit.com/t3_x"), "reddit.com");
});

test("no referrer, a bad one, or the game itself is direct", () => {
  assert.equal(from(""), "direct");
  assert.equal(from("not a url"), "direct");
  assert.equal(from("https://haribary.github.io/sloprillion/?day=1"), "direct");
  assert.equal(visitSource(), "direct");
});

test("the personal site that hosts the game is a source of its own", () => {
  assert.equal(from("https://haribary.github.io/"), "haribary.github.io");
  assert.equal(from("https://haribary.github.io/?lab=signal"), "haribary.github.io");
});

test("a host that cannot be a label is other", () => {
  assert.equal(from("https://" + "a".repeat(45) + ".example.com/"), "other"); // longer than a label may be
  assert.equal(from("http://[::1]:8080/"), "other");
});

test("cleanSource tidies case and spaces and refuses the rest", () => {
  assert.equal(cleanSource("  Discord "), "discord");
  assert.equal(cleanSource("x.com"), "x.com");
  assert.equal(cleanSource("a_b-c.9"), "a_b-c.9");
  for (const bad of [null, undefined, 7, "", " ", ".dot", "-dash", "a b", "a/b", "é", "a".repeat(41)]) assert.equal(cleanSource(bad), null, String(bad));
});
