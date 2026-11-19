import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRounds } from "../src/wiring.mjs";
import { buildIndex, match, matchWrong } from "../../src/match.js";
import { calendar, pickByDate, dayNumber, daysLeft, daysBetween, forcedEntry } from "../../src/rounds/index.js";

test("loadRounds returns every round in index.js and nothing else", async () => {
  const rounds = await loadRounds();
  assert.deepEqual(rounds.map((r) => ({ id: r.id, date: r.date })), calendar, "each file matches its calendar line");
  calendar.forEach((e, i) => {
    assert.equal(e.id, i + 1, "ids count up from 1");
    if (i) assert.equal(daysBetween(calendar[i - 1].date, e.date), 1, `round ${e.id} is the day after round ${e.id - 1}`);
  });
  for (const r of rounds) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(r.prompts) && r.prompts.length === 7, `round ${r.id} has seven prompts`);
  }
  assert.ok(rounds.every((r) => !("rounds" in r)), "index.js is not loaded as a round");
});

test("every round file in src/rounds is listed in index.js", async () => {
  const dir = fileURLToPath(new URL("../../src/rounds/", import.meta.url));
  const files = readdirSync(dir).filter((f) => /^\d+\.js$/.test(f));
  assert.equal(files.length, (await loadRounds()).length);
});

test("the shipped wrong answers resolve to a reason and lose to real answers", async () => {
  const [one, two] = await loadRounds();
  const founders = buildIndex(one.prompts.find((p) => p.id === "big-tech-founder"));
  assert.match(matchWrong(founders, "tim cook").why, /did not found/);
  assert.equal(matchWrong(founders, "cook")?.a, "Tim Cook"); // surname, as for a people prompt
  assert.equal(matchWrong(founders, "tim coook"), null); // no typo tolerance
  assert.equal(match(founders, "tim cook"), null);
  const yc = buildIndex(two.prompts.find((p) => p.id === "yc-unicorn"));
  assert.equal(matchWrong(yc, "Twitch").why, "Sold to Amazon for $970 million, just under the bar.");
  assert.equal(matchWrong(yc, "justin tv").a, "Twitch");
  assert.notEqual(match(yc, "airbnb"), null);
  assert.equal(matchWrong(yc, "airbnb"), null);
});

test("the day's round, and what happens when the rounds run out", () => {
  const first = calendar[0], last = calendar.at(-1), n = calendar.length;
  const after = (k) => new Date(Date.parse(last.date + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10);
  assert.equal(pickByDate(calendar, first.date).id, 1);
  assert.equal(pickByDate(calendar, "2020-01-01").id, 1, "before the first round");
  assert.equal(pickByDate(calendar, last.date).id, n);
  assert.equal(pickByDate(calendar, after(1)).id, 1, "the day after the last round is round 1 again");
  assert.equal(pickByDate(calendar, after(n)).id, n);
  assert.equal(pickByDate(calendar, after(n + 1)).id, 1);
  assert.equal(pickByDate(calendar, after(1000 * n + 2)).id, 2, "and so on for as long as it takes");
  assert.equal(dayNumber(calendar, first.date), 1);
  assert.equal(dayNumber(calendar, last.date), n);
  assert.equal(dayNumber(calendar, after(3)), n + 3, "the day number keeps counting");
  assert.equal(daysLeft(calendar, first.date), n - 1);
  assert.equal(daysLeft(calendar, last.date), 0);
  assert.equal(daysLeft(calendar, after(5)), 0);
});

test("?day= forces a round by its id", () => {
  assert.equal(forcedEntry("2").id, 2);
  assert.equal(forcedEntry(1).date, calendar[0].date);
  assert.equal(forcedEntry("nope"), null);
  assert.equal(forcedEntry(null), null);
  assert.equal(forcedEntry(undefined), null);
});
