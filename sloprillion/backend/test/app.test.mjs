import test from "node:test";
import assert from "node:assert/strict";
import { createApp, normKey } from "../src/app.mjs";
import { createMemoryStore } from "../src/store-memory.mjs";

const round = {
  id: 7,
  date: "2030-05-10",
  prompts: [
    {
      id: "p1", category: "Cat", q: "Name a thing", note: "Any era",
      answers: [
        { a: "Alpha", pts: 10, alt: ["a1"] },
        { a: "Bravo Charlie", pts: 40, fact: "Bravo fact." },
        { a: "Delta Force", pts: 70 },
        { a: "Echo", pts: 100 },
      ],
      wrong: [{ a: "Whiskey", alt: ["whisk"], why: "A real thing, but not in this set." }],
    },
    { id: "p2", category: "Cat", q: "Another", note: "", answers: [{ a: "Zulu", pts: 15 }, { a: "Yankee", pts: 60 }] },
  ],
};
const earlier = { id: 6, date: "2030-05-01", prompts: [{ id: "old", category: "C", q: "Q", note: "", answers: [{ a: "One", pts: 10 }] }] };

const DATE = "2030-05-10";
const NOW = Date.UTC(2030, 4, 10, 12); // the server's clock: noon UTC on the round's day
let n = 0;
const sid = () => "sess" + String(++n).padStart(6, "0");

function setup({ judgeImpl, config } = {}) {
  const store = createMemoryStore();
  const calls = [];
  const judge = async (args) => {
    calls.push(args);
    return judgeImpl ? judgeImpl(args) : { valid: false, canonical: null, rarity: 10, why: "no" };
  };
  const app = createApp({ store, judge, rounds: [earlier, round], config, now: () => NOW });
  const post = async (path, body) => app({ method: "POST", path, body: JSON.stringify(body) });
  const answer = (session, promptId, text, extra = {}) => post("/v1/answer", { date: DATE, promptId, session, text, ...extra });
  return { app, store, calls, post, answer };
}

test("round fetch never leaks answers", async () => {
  const { app } = setup();
  const r = await app({ method: "GET", path: "/v1/round", query: { date: DATE } });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 7);
  assert.deepEqual(Object.keys(r.body.prompts[0]).sort(), ["category", "id", "note", "q"]);
  const s = JSON.stringify(r.body);
  for (const w of ["Alpha", "Bravo", "\"pts\"", "answers", "fact", "Whiskey", "wrong"]) assert.ok(!s.includes(w), w);
});

test("the day's round: the latest on or before it, the first for earlier days, and round again after the last", async () => {
  const { app } = setup();
  const get = async (date) => (await app({ method: "GET", path: "/v1/round", query: { date } })).body;
  const brief = async (date) => { const r = await get(date); return [r.id, r.date, r.day]; };
  assert.deepEqual(await brief(DATE), [7, DATE, 2]);
  assert.deepEqual(await brief("2030-05-05"), [6, "2030-05-05", 1]); // between the two rounds
  assert.deepEqual(await brief("2020-01-01"), [6, "2020-01-01", 1]); // before the first
  // After the last round they come round again, oldest first, and the day number counts on.
  assert.deepEqual(await brief("2030-05-11"), [6, "2030-05-11", 3]);
  assert.deepEqual(await brief("2030-05-12"), [7, "2030-05-12", 4]);
  assert.deepEqual(await brief("2030-05-13"), [6, "2030-05-13", 5]);
  assert.equal((await get("2030-05-12")).prompts[0].id, "p1");
});

test("a round's second outing has its own tally, shares the one board, and reuses cached verdicts", async () => {
  const store = createMemoryStore();
  let judged = 0;
  const judge = async () => { judged++; return { valid: true, canonical: "Foxtrot", rarity: 60, why: "ok" }; };
  const app = createApp({ store, judge, rounds: [earlier, round], now: () => Date.UTC(2030, 4, 12, 12) });
  const post = (path, body) => app({ method: "POST", path, body: JSON.stringify(body) });
  const first = sid(), again = sid();
  // Round 7 is played on its own date, and again two days later (6, 7, then 6, 7).
  assert.equal((await post("/v1/answer", { date: DATE, promptId: "p1", session: first, text: "foxtrot" })).body.how, "judge");
  await post("/v1/finish", { date: DATE, session: first, name: "First" });
  const r = await post("/v1/answer", { date: "2030-05-12", promptId: "p1", session: again, text: "foxtrot" });
  assert.equal(r.body.valid, true);
  assert.equal(r.body.how, "cache");
  assert.equal(judged, 1);
  const fin = (await post("/v1/finish", { date: "2030-05-12", session: again, name: "Again" })).body;
  assert.equal(fin.dist.players, 1);
  // Both days' results are on the board, whichever day it is asked for.
  assert.deepEqual(fin.board.top.map((x) => x.name), ["First", "Again"]);
  const old = (await app({ method: "GET", path: "/v1/board", query: { date: DATE } })).body;
  assert.deepEqual(old.top.map((x) => x.name), ["First", "Again"]);
  // The day in between belongs to the other round.
  assert.equal((await post("/v1/answer", { date: "2030-05-11", promptId: "p1", session: sid(), text: "alpha" })).status, 404);
  assert.equal((await post("/v1/answer", { date: "2030-05-11", promptId: "old", session: sid(), text: "one" })).body.valid, true);
});

test("a day more than one ahead of UTC cannot be written to; reading it is harmless", async () => {
  const ctx = setup(); // the clock says noon UTC on 2030-05-10
  const session = sid();
  const writes = [["/v1/answer", { promptId: "p1", session, text: "alpha" }], ["/v1/finish", { session }], ["/v1/visit", { src: "x" }]];
  for (const [path, body] of writes) {
    const r = await ctx.post(path, { date: "2030-05-12", ...body });
    assert.equal(r.status, 400, path);
    assert.match(r.body.error, /future/, path);
  }
  assert.equal((await ctx.post("/v1/visit", { date: "2030-05-11", src: "x" })).status, 200); // tomorrow, for someone east of UTC
  assert.equal((await ctx.answer(session, "p1", "alpha")).body.valid, true); // today still works
  const ahead = await ctx.app({ method: "GET", path: "/v1/board", query: { date: "2030-05-12" } });
  assert.equal(ahead.status, 200);
  assert.deepEqual(ahead.body.top, []);
});

test("bank hit, alias hit and typo hit", async () => {
  const { answer, calls } = setup();
  const a = await (await answer(sid(), "p1", "  alpha ")).body;
  assert.equal(a.valid, true);
  assert.equal(a.how, "bank");
  assert.deepEqual(a.answer, { a: "Alpha", pts: 10 });
  const b = await (await answer(sid(), "p1", "A1")).body;
  assert.equal(b.answer.a, "Alpha");
  const c = await (await answer(sid(), "p1", "bravo charlee")).body; // typo
  assert.equal(c.answer.a, "Bravo Charlie");
  assert.equal(c.answer.fact, "Bravo fact.");
  assert.equal(c.how, "bank");
  assert.equal(calls.length, 0);
});

test("stats come with a locked prompt and describe the bank", async () => {
  const { answer } = setup();
  const r = (await answer(sid(), "p1", "echo")).body;
  assert.deepEqual(r.stats, { most: { a: "Alpha", pts: 10 }, rarest: { a: "Echo", pts: 100 }, count: 4 });
});

test("a wrong answer keeps the round open and counts down", async () => {
  const { answer } = setup();
  const s = sid();
  const r1 = (await answer(s, "p1", "nonsense")).body;
  assert.deepEqual(r1, { valid: false, attemptsLeft: 11 });
  assert.ok(!("stats" in r1));
  assert.equal((await answer(s, "p1", "more nonsense")).body.attemptsLeft, 10);
  assert.equal((await answer(s, "p1", "delta force")).body.valid, true);
});

test("12 wrong attempts lock the prompt as a miss", async () => {
  const { answer } = setup();
  const s = sid();
  let last;
  for (let i = 0; i < 12; i++) last = (await answer(s, "p1", "wrong" + i)).body;
  assert.equal(last.valid, false);
  assert.equal(last.locked, true);
  assert.equal(last.stats.count, 4);
  const again = await answer(s, "p1", "alpha");
  assert.equal(again.status, 400);
});

test("timeout locks and returns stats; a second answer is refused", async () => {
  const { answer } = setup();
  const s = sid();
  const t = (await answer(s, "p1", undefined, { timeout: true, text: undefined })).body;
  assert.equal(t.valid, false);
  assert.equal(t.locked, true);
  assert.equal(t.stats.rarest.a, "Echo");
  assert.equal((await answer(s, "p1", "alpha")).status, 400);
  assert.equal((await answer(s, "p1", undefined, { timeout: true })).status, 400);
});

test("a second answer to an answered prompt is refused", async () => {
  const { answer } = setup();
  const s = sid();
  assert.equal((await answer(s, "p1", "alpha")).body.valid, true);
  const r = await answer(s, "p1", "echo");
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already/);
});

test("judge runs once for an unknown answer; another session is served from cache", async () => {
  const { answer, calls } = setup({ judgeImpl: () => ({ valid: true, canonical: "Foxtrot", rarity: 62.4, why: "fits" }) });
  const r1 = (await answer(sid(), "p1", "Foxtrot")).body;
  assert.equal(r1.how, "judge");
  assert.deepEqual(r1.answer, { a: "Foxtrot", pts: 62 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].prompt.id, "p1");
  assert.ok(calls[0].prompt.examples.length >= 3 && calls[0].prompt.examples.length <= 8);
  assert.ok(!("answers" in calls[0].prompt));
  const r2 = (await answer(sid(), "p1", "  fox-trot!! ".replace("fox-trot!!", "foxtrot"))).body;
  assert.equal(r2.how, "cache");
  assert.equal(r2.answer.pts, 62);
  assert.equal(calls.length, 1);
});

test("a rejected answer is cached too and does not call the judge again", async () => {
  const { answer, calls } = setup({ judgeImpl: () => ({ valid: false, canonical: null, rarity: 10, why: "off topic" }) });
  assert.equal((await answer(sid(), "p1", "banana")).body.valid, false);
  assert.equal((await answer(sid(), "p1", "Banana")).body.valid, false);
  assert.equal(calls.length, 1);
});

test("a judge-approved alias of a bank answer gets bank points and fact", async () => {
  const { answer, calls } = setup({ judgeImpl: () => ({ valid: true, canonical: "Bravo Charlie", rarity: 90, why: "same thing" }) });
  const r = (await answer(sid(), "p1", "the bravo one")).body;
  assert.equal(r.how, "judge");
  assert.deepEqual(r.answer, { a: "Bravo Charlie", pts: 40, fact: "Bravo fact." });
  const r2 = (await answer(sid(), "p1", "the bravo one")).body;
  assert.equal(r2.how, "cache");
  assert.equal(r2.answer.pts, 40);
  assert.equal(calls.length, 1);
});

test("new judge answers are clamped to 20..95", async () => {
  let rar = 3;
  const { answer } = setup({ judgeImpl: ({ text }) => ({ valid: true, canonical: text, rarity: rar, why: "" }) });
  assert.equal((await answer(sid(), "p1", "lowball")).body.answer.pts, 20);
  rar = 100;
  assert.equal((await answer(sid(), "p1", "highball")).body.answer.pts, 95);
});

test("spellings of one new answer share its points", async () => {
  const { answer } = setup({
    judgeImpl: ({ text }) => ({ valid: true, canonical: "Golf Cart", rarity: text === "golfcart" ? 50 : 80, why: "" }),
  });
  const a = (await answer(sid(), "p1", "golfcart")).body.answer;
  const b = (await answer(sid(), "p1", "cart for golf")).body.answer;
  assert.equal(a.pts, 50);
  assert.equal(b.pts, 50);
  assert.equal(b.a, "Golf Cart");
});

test("judge failure and timeout are not cached", async () => {
  let mode = "throw";
  const { answer, calls } = setup({
    config: { judgeTimeoutMs: 30 },
    judgeImpl: () => {
      if (mode === "throw") throw new Error("boom");
      if (mode === "hang") return new Promise(() => {});
      return { valid: true, canonical: "Hotel", rarity: 70, why: "" };
    },
  });
  assert.deepEqual((await answer(sid(), "p1", "hotel")).body, { valid: false, attemptsLeft: 11 });
  mode = "hang";
  assert.equal((await answer(sid(), "p1", "hotel")).body.valid, false);
  mode = "ok";
  const r = (await answer(sid(), "p1", "hotel")).body;
  assert.equal(r.valid, true);
  assert.equal(r.how, "judge");
  assert.equal(calls.length, 3);
});

test("a malformed judge verdict is treated as a failure", async () => {
  const { answer } = setup({ judgeImpl: () => ({ nope: 1 }) });
  assert.equal((await answer(sid(), "p1", "kilo")).body.valid, false);
  assert.equal((await answer(sid(), "p1", "kilo")).body.valid, false);
});

test("per-session judge cap: 6 calls per prompt", async () => {
  const { answer, calls } = setup();
  const s = sid();
  for (let i = 0; i < 9; i++) await answer(s, "p1", "unknown" + i);
  assert.equal(calls.length, 6);
  // a different prompt has its own allowance
  await answer(s, "p2", "other");
  assert.equal(calls.length, 7);
});

test("daily judge cap", async () => {
  const { answer, calls } = setup({ config: { judgeDailyCap: 3 } });
  for (let i = 0; i < 5; i++) await answer(sid(), "p1", "unk" + i);
  assert.equal(calls.length, 3);
  // cached verdicts and bank hits still work once the budget is gone
  assert.equal((await answer(sid(), "p1", "unk0")).body.valid, false);
  assert.equal((await answer(sid(), "p1", "alpha")).body.valid, true);
  assert.equal(calls.length, 3);
});

test("the judge budget belongs to the real day, whatever day the player claims", async () => {
  const { post, calls } = setup({ config: { judgeDailyCap: 3 } });
  const ask = (date, text) => post("/v1/answer", { date, promptId: date === "2030-05-09" || date === "2030-05-04" ? "old" : "p1", session: sid(), text });
  // Three allowed days (yesterday, today, tomorrow), one shared budget of three calls.
  for (const [i, date] of ["2030-05-09", "2030-05-10", "2030-05-11", "2030-05-09", "2030-05-10"].entries()) {
    assert.equal((await ask(date, "unknown" + i)).status, date === "2030-05-11" ? 404 : 200, date);
  }
  assert.equal(calls.length, 3);
});

test("a day more than a week old is closed to writing", async () => {
  const ctx = setup(); // the clock says noon UTC on 2030-05-10
  const session = sid();
  assert.equal((await ctx.post("/v1/visit", { date: "2030-05-03", src: "x" })).status, 200); // seven days back: still open
  for (const [path, body] of [["/v1/answer", { promptId: "old", session, text: "one" }], ["/v1/finish", { session }], ["/v1/visit", { src: "x" }]]) {
    const r = await ctx.post(path, { date: "2030-05-02", ...body });
    assert.equal(r.status, 400, path);
    assert.match(r.body.error, /past/, path);
  }
  assert.equal((await ctx.app({ method: "GET", path: "/v1/board", query: { date: "2030-05-02" } })).status, 200); // reading is fine
});

test("accepted answers are counted per canonical name", async () => {
  const { answer, store } = setup();
  await answer(sid(), "p1", "alpha");
  await answer(sid(), "p1", "a1");
  await answer(sid(), "p1", "echo");
  assert.equal(await store.getCount(DATE, "p1", normKey("Alpha")), 2);
  assert.equal(await store.getCount(DATE, "p1", normKey("Echo")), 1);
});

test("bank-hit path costs one state read, one lock and one counter write", async () => {
  const { answer, store } = setup();
  const seen = [];
  for (const k of Object.keys(store)) {
    const f = store[k];
    store[k] = (...a) => { seen.push(k); return f(...a); };
  }
  await answer(sid(), "p1", "alpha");
  assert.deepEqual(seen, ["getState", "lock", "incCount"]);
});

test("finish computes the score on the server, is idempotent, and the histogram is right", async () => {
  const { answer, post } = setup();
  const play = async (s, texts) => {
    for (const [pid, t] of texts) await answer(s, pid, t);
  };
  const s1 = sid(), s2 = sid(), s3 = sid();
  await play(s1, [["p1", "alpha"], ["p2", "zulu"]]); // 25
  await play(s2, [["p1", "echo"], ["p2", "yankee"]]); // 160
  await play(s3, [["p1", "bravo charlie"]]); // 40
  const f1 = (await post("/v1/finish", { date: DATE, session: s1 })).body;
  assert.equal(f1.score, 25);
  assert.deepEqual(f1.results, [{ promptId: "p1", a: "Alpha", pts: 10 }, { promptId: "p2", a: "Zulu", pts: 15 }]);
  assert.equal(f1.dist.players, 1);
  assert.equal(f1.ahead, 0.5);
  const f1b = (await post("/v1/finish", { date: DATE, session: s1 })).body;
  assert.equal(f1b.dist.players, 1);
  assert.equal(f1b.score, 25);
  await post("/v1/finish", { date: DATE, session: s2 });
  const f3 = (await post("/v1/finish", { date: DATE, session: s3 })).body;
  assert.equal(f3.score, 40);
  assert.equal(f3.dist.players, 3);
  assert.equal(f3.dist.counts.length, 71);
  assert.equal(f3.dist.counts[2], 1);
  assert.equal(f3.dist.counts[4], 1);
  assert.equal(f3.dist.counts[16], 1);
  assert.equal(f3.ahead, (1 + 0.5) / 3); // s1 below, itself tied
  const f2 = (await post("/v1/finish", { date: DATE, session: s2 })).body;
  assert.equal(f2.ahead, (2 + 0.5) / 3);
});

test("a session that answered nothing finishes with 0", async () => {
  const { post } = setup();
  const f = (await post("/v1/finish", { date: DATE, session: sid() })).body;
  assert.equal(f.score, 0);
  assert.equal(f.results.length, 2);
  assert.ok(f.results.every((r) => r.a === null && r.pts === 0));
});

test("GET /v1/dist", async () => {
  const { app, answer, post } = setup();
  const s = sid();
  await answer(s, "p1", "echo");
  await post("/v1/finish", { date: DATE, session: s });
  const r = await app({ method: "GET", path: "/v1/dist", query: { date: DATE } });
  assert.equal(r.status, 200);
  assert.equal(r.body.players, 1);
  assert.equal(r.body.counts[10], 1);
});

test("OPTIONS is 204", async () => {
  const { app } = setup();
  assert.equal((await app({ method: "OPTIONS", path: "/v1/anything" })).status, 204);
});

test("input validation and routing errors", async () => {
  const { app, post, answer } = setup();
  const bad = async (res, status) => {
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.equal(typeof res.body.error, "string");
    assert.ok(!/at .*\.mjs|stack/i.test(res.body.error));
  };
  await bad(await app({ method: "GET", path: "/v1/round", query: { date: "nope" } }), 400);
  await bad(await app({ method: "GET", path: "/nope" }), 404);
  await bad(await app({ method: "DELETE", path: "/v1/round" }), 404);
  await bad(await app({ method: "POST", path: "/v1/answer", body: "{not json" }), 400);
  await bad(await app({ method: "POST", path: "/v1/answer" }), 400);
  await bad(await answer("short", "p1", "alpha"), 400);
  await bad(await answer("has space in it!", "p1", "alpha"), 400);
  await bad(await answer(sid(), "p1", ""), 400);
  await bad(await answer(sid(), "p1", "   "), 400);
  await bad(await answer(sid(), "p1", "x".repeat(61)), 400);
  await bad(await answer(sid(), "p1", 42), 400);
  await bad(await answer(sid(), "nope", "alpha"), 404);
  await bad(await post("/v1/answer", { date: "2030-13-40", promptId: "p1", session: sid(), text: "a" }), 400);
  await bad(await post("/v1/finish", { date: DATE, session: "x" }), 400);
  const ok = await answer(sid(), "p1", "x".repeat(60));
  assert.equal(ok.status, 200);
});

test("store failure becomes a plain 500 with no details", async () => {
  const store = createMemoryStore();
  store.getState = async () => { throw new Error("secret table arn"); };
  const app = createApp({ store, judge: async () => ({}), rounds: [round], now: () => NOW });
  const orig = console.error;
  console.error = () => {};
  const r = await app({ method: "POST", path: "/v1/answer", body: { date: DATE, promptId: "p1", session: sid(), text: "alpha" } });
  console.error = orig;
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "internal error" });
});

test("a known-wrong answer is refused with its reason and never reaches the judge", async () => {
  const { answer, calls, store } = setup({ judgeImpl: () => ({ valid: true, canonical: "Whiskey", rarity: 50, why: "yes" }) });
  const s = sid();
  const r1 = await answer(s, "p1", " WHISK ");
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body, { valid: false, attemptsLeft: 11, why: "A real thing, but not in this set." });
  assert.equal((await answer(s, "p1", "whiskey")).body.attemptsLeft, 10); // counts as an attempt
  assert.equal(calls.length, 0);
  assert.equal(await store.getVerdict("7:p1", "whiskey"), null); // nothing cached either
  assert.equal((await answer(s, "p1", "echo")).body.valid, true); // the round was still open
});

test("a plain miss carries no why", async () => {
  const { answer } = setup();
  assert.ok(!("why" in (await answer(sid(), "p1", "nonsense")).body));
});

test("wrong answers use up attempts like any other miss", async () => {
  const { answer } = setup();
  const s = sid();
  let last;
  for (let i = 0; i < 12; i++) last = (await answer(s, "p1", "whiskey")).body;
  assert.equal(last.locked, true);
});

test("a wrong entry that collides with a real answer is dropped and the real answer wins", async () => {
  const clash = {
    id: 9, date: "2031-01-01",
    prompts: [{ id: "c", category: "C", q: "Q", note: "", answers: [{ a: "Alpha", pts: 10 }, { a: "Zed", pts: 100 }], wrong: [{ a: "alpha", why: "No." }, { a: "Beta", why: "Nope." }] }],
  };
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(m);
  const app = createApp({ store: createMemoryStore(), judge: async () => ({ valid: false }), rounds: [clash], now: () => Date.UTC(2031, 0, 1, 12) });
  const ask = (text) => app({ method: "POST", path: "/v1/answer", body: { date: "2031-01-01", promptId: "c", session: sid(), text } });
  let first;
  try { first = await ask("alpha"); } finally { console.warn = orig; } // the round's tables are built on first use
  assert.equal(warned.length, 1);
  assert.match(warned[0], /"alpha" is both a wrong answer and an answer/);
  assert.equal(first.body.valid, true);
  assert.equal((await ask("beta")).body.why, "Nope.");
});

// ---- leaderboard ----

// Plays p1 and p2 with the given answers and finishes, optionally under a name.
async function play(ctx, session, a1, a2, name) {
  if (a1) await ctx.answer(session, "p1", a1);
  if (a2) await ctx.answer(session, "p2", a2);
  return (await ctx.post("/v1/finish", { date: DATE, session, ...(name === undefined ? {} : { name }) })).body;
}
const board = (ctx, query = {}) => ctx.app({ method: "GET", path: "/v1/board", query: { date: DATE, ...query } });

test("a named finish goes on the board; an unnamed one does not", async () => {
  const ctx = setup();
  const named = sid(), unnamed = sid();
  const r = await play(ctx, named, "Echo", "Yankee", "  Ada   Lovelace ");
  assert.equal(r.score, 160);
  assert.deepEqual(r.board.top, [{ rank: 1, name: "Ada Lovelace", score: 160, me: true }]);
  assert.deepEqual(r.board.you, { rank: 1, name: "Ada Lovelace", score: 160 });
  assert.equal(r.nameError, undefined);
  const u = await play(ctx, unnamed, "Alpha", "Zulu");
  assert.equal(u.board.you, null);
  assert.deepEqual(u.board.top, [{ rank: 1, name: "Ada Lovelace", score: 160 }]);
  // both still count as players in the distribution
  assert.equal(u.dist.players, 2);
});

test("GET /v1/board: top rows, best first, the caller's own row marked, no keys or sessions", async () => {
  const ctx = setup({ config: { boardSize: 3 } });
  const sessions = {};
  for (const [name, a1, a2] of [["Low", "Alpha", "Zulu"], ["High", "Echo", "Yankee"], ["Mid", "Delta Force", "Zulu"], ["Last", "Alpha", null]]) {
    sessions[name] = sid();
    await play(ctx, sessions[name], a1, a2, name);
  }
  const anon = (await board(ctx)).body;
  assert.equal(anon.date, DATE);
  assert.deepEqual(anon.top, [
    { rank: 1, name: "High", score: 160 },
    { rank: 2, name: "Mid", score: 85 },
    { rank: 3, name: "Low", score: 25 },
  ]);
  assert.equal(anon.you, null);
  const mid = (await board(ctx, { session: sessions.Mid })).body;
  assert.deepEqual(mid.top[1], { rank: 2, name: "Mid", score: 85, me: true });
  assert.deepEqual(mid.you, { rank: 2, name: "Mid", score: 85 });
  // outside the top rows: not listed, but told where they stand
  const last = (await board(ctx, { session: sessions.Last })).body;
  assert.equal(last.top.some((row) => row.me), false);
  assert.deepEqual(last.you, { rank: 4, name: "Last", score: 10 });
  const raw = JSON.stringify([anon, mid, last]);
  for (const s of Object.values(sessions)) assert.ok(!raw.includes(s), "a session id leaked");
  assert.ok(!raw.includes('"key"'));
});

test("the first name stays; finishing again cannot rename or rescore", async () => {
  const ctx = setup();
  const s = sid();
  await play(ctx, s, "Echo", "Yankee", "First");
  const again = (await ctx.post("/v1/finish", { date: DATE, session: s, name: "Second" })).body;
  assert.equal(again.score, 160);
  assert.deepEqual(again.board.you, { rank: 1, name: "First", score: 160 });
  assert.equal((await board(ctx)).body.top.length, 1);
});

test("a player who skipped the name can add one after finishing", async () => {
  const ctx = setup();
  const s = sid();
  const first = await play(ctx, s, "Bravo Charlie", "Zulu");
  assert.equal(first.board.you, null);
  const later = (await ctx.post("/v1/finish", { date: DATE, session: s, name: "Late" })).body;
  assert.deepEqual(later.board.you, { rank: 1, name: "Late", score: 55 });
  assert.equal(later.dist.players, 1, "adding a name must not count the player twice");
});

test("a refused name keeps the score but stays off the board, and says why", async () => {
  const ctx = setup();
  for (const [name, reason] of [["<script>", "invalid"], ["x".repeat(17), "long"], ["...", "invalid"], [42, "invalid"]]) {
    const r = await play(ctx, sid(), "Alpha", "Zulu", name);
    assert.equal(r.score, 25);
    assert.equal(r.nameError, reason, String(name));
    assert.equal(r.board.you, null);
  }
  assert.equal((await board(ctx)).body.top.length, 0);
  // a refused name can be replaced
  const s = sid();
  await play(ctx, s, "Alpha", "Zulu", "bad<name>");
  const fixed = (await ctx.post("/v1/finish", { date: DATE, session: s, name: "Good Name" })).body;
  assert.deepEqual(fixed.board.you, { rank: 1, name: "Good Name", score: 25 });
});

test("ties rank by who finished first", async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2030, 4, 10, 12);
  const app = createApp({ store, judge: async () => ({ valid: false }), rounds: [earlier, round], now: () => (clock += 1000) });
  const post = (path, body) => app({ method: "POST", path, body: JSON.stringify(body) });
  for (const name of ["Early", "Later"]) {
    const session = sid();
    await post("/v1/answer", { date: DATE, promptId: "p1", session, text: "Echo" });
    await post("/v1/finish", { date: DATE, session, name });
  }
  const top = (await app({ method: "GET", path: "/v1/board", query: { date: DATE } })).body.top;
  assert.deepEqual(top.map((row) => [row.rank, row.name]), [[1, "Early"], [2, "Later"]]);
});

test("GET /v1/board rejects a malformed session and is empty before anyone is on it", async () => {
  const ctx = setup();
  assert.equal((await board(ctx, { session: "no" })).status, 400);
  const quiet = (await board(ctx)).body;
  assert.deepEqual(quiet.top, []);
  assert.equal(quiet.you, null);
});

test("the board holds every day's results; `you` is the asked day's game and `me` marks the caller's rows from any day", async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2030, 4, 10, 12);
  const app = createApp({ store, judge: async () => ({ valid: false }), rounds: [earlier, round], config: { boardSize: 3 }, now: () => (clock += 1000) });
  const post = (path, body) => app({ method: "POST", path, body: JSON.stringify(body) });
  const get = async (date, session) => (await app({ method: "GET", path: "/v1/board", query: { date, ...(session ? { session } : {}) } })).body;
  const NEXT = "2030-05-11"; // the day after: the rounds come round again, so this is round 6
  const finish = async (date, session, name, promptId, text) => {
    await post("/v1/answer", { date, promptId, session, text });
    return (await post("/v1/finish", { date, session, name })).body;
  };
  const regular = sid(), visitor = sid(), third = sid(), fourth = sid();
  await finish(DATE, regular, "Regular", "p1", "Echo"); // 100
  await finish(DATE, visitor, "Visitor", "p1", "Delta Force"); // 70
  await finish(DATE, third, "Third", "p1", "Bravo Charlie"); // 40
  clock = Date.UTC(2030, 4, 11, 12);
  // The same browser plays the next day for 10 points: a second entry of its own, below the listed rows.
  const next = await finish(NEXT, regular, "Regular", "old", "One");
  assert.deepEqual(next.board.top, [
    { rank: 1, name: "Regular", score: 100, me: true },
    { rank: 2, name: "Visitor", score: 70 },
    { rank: 3, name: "Third", score: 40 },
  ]);
  assert.deepEqual(next.board.you, { rank: 4, name: "Regular", score: 10 });
  // Asked about the first day, the same board, and `you` is that day's game.
  assert.deepEqual(await get(DATE, regular), { date: DATE, top: next.board.top, you: { rank: 1, name: "Regular", score: 100 } });
  // A player with nothing on the board for the asked day has no `you`, even with a row from an earlier day.
  const before = await get(NEXT, visitor);
  assert.equal(before.you, null);
  assert.deepEqual(before.top[1], { rank: 2, name: "Visitor", score: 70, me: true });
  // A new player the next day lands among the earlier days' results.
  const late = await finish(NEXT, fourth, "Fourth", "old", "One");
  assert.deepEqual(late.board.you, { rank: 5, name: "Fourth", score: 10 });
  assert.deepEqual((await get(NEXT)).top.map((row) => [row.rank, row.name, row.score]), [[1, "Regular", 100], [2, "Visitor", 70], [3, "Third", 40]]);
  // The owner's view of a day still lists only that day's names.
  const store2 = (date) => store.getBoardTop(date, 10).then((rows) => rows.map((row) => row.name));
  assert.deepEqual(await store2(DATE), ["Regular", "Visitor", "Third"]);
  assert.deepEqual(await store2(NEXT), ["Regular", "Fourth"]);
});

// ---- visits, sources and the owner's stats ----

const KEY = "test-stats-key";
const counted = () => setup({ config: { statsKey: KEY } });
const stats = async ({ app }, query = {}) => app({ method: "GET", path: "/v1/stats", query: { key: KEY, to: DATE, days: "2", ...query } });

test("visits are counted per day, per part of the site and per source", async () => {
  const ctx = counted();
  const visit = (where, src, date = DATE) => ctx.post("/v1/visit", { date, where, src });
  for (const [where, src] of [["game", "x"], ["game", "x"], ["game", "direct"], ["site", "direct"], ["site", "news.ycombinator.com"]]) {
    assert.equal((await visit(where, src)).status, 200);
  }
  assert.equal((await ctx.post("/v1/visit", { date: DATE, src: "x" })).status, 200); // no `where` means the game
  await visit("site", "direct", "2030-05-09");
  const r = await stats(ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.days, [
    {
      date: DATE, round: 7, site: 2, game: 4, finished: 0,
      sources: [
        { src: "x", site: 0, game: 3, finished: 0 },
        { src: "direct", site: 1, game: 1, finished: 0 },
        { src: "news.ycombinator.com", site: 1, game: 0, finished: 0 },
      ],
    },
    { date: "2030-05-09", round: 6, site: 1, game: 0, finished: 0, sources: [{ src: "direct", site: 1, game: 0, finished: 0 }] },
  ]);
});

test("a visit needs a well-formed source and a part of the site that exists", async () => {
  const ctx = counted();
  for (const src of [undefined, "", 7, "has space", "-leading", "<script>", "x".repeat(41)]) {
    assert.equal((await ctx.post("/v1/visit", { date: DATE, src })).status, 400, String(src));
  }
  for (const where of ["blog", "", 3, null]) {
    assert.equal((await ctx.post("/v1/visit", { date: DATE, where, src: "x" })).status, 400, String(where));
  }
  assert.equal((await ctx.post("/v1/visit", { date: DATE, where: "site", src: "  Discord " })).status, 200); // tidied, not refused
  assert.deepEqual((await stats(ctx)).body.days[0].sources, [{ src: "discord", site: 1, game: 0, finished: 0 }]);
});

test("a finished game is credited to its source once; no source counts as unknown", async () => {
  const ctx = counted();
  const tagged = sid(), plain = sid();
  await ctx.answer(tagged, "p1", "Echo");
  await ctx.post("/v1/finish", { date: DATE, session: tagged, src: "x" });
  await ctx.post("/v1/finish", { date: DATE, session: tagged, src: "x" }); // finishing again adds nothing
  await ctx.post("/v1/finish", { date: DATE, session: plain, src: "not a label" });
  const day = (await stats(ctx)).body.days[0];
  assert.equal(day.finished, 2);
  assert.deepEqual(day.sources, [
    { src: "unknown", site: 0, game: 0, finished: 1 },
    { src: "x", site: 0, game: 0, finished: 1 },
  ]);
});

test("a failing source count never fails the finish", async () => {
  const ctx = setup();
  ctx.store.addSource = async () => { throw new Error("boom"); };
  const session = sid();
  await ctx.answer(session, "p1", "Echo");
  const orig = console.error;
  console.error = () => {};
  const r = await ctx.post("/v1/finish", { date: DATE, session, src: "x" });
  console.error = orig;
  assert.equal(r.status, 200);
  assert.equal(r.body.score, 100);
});

test("stats need the configured key, and do not exist without one", async () => {
  const open = setup(); // no key configured
  assert.equal((await stats(open)).status, 404);
  const ctx = counted();
  assert.equal((await stats(ctx, { key: "wrong" })).status, 404);
  assert.equal((await stats(ctx, { key: "" })).status, 404);
  assert.equal((await ctx.app({ method: "GET", path: "/v1/stats", query: {} })).status, 404);
  assert.equal((await stats(ctx)).status, 200);
  // days: 14 by default, at most 60, newest first, ending today (UTC) unless told otherwise
  const plain = (await ctx.app({ method: "GET", path: "/v1/stats", query: { key: KEY } })).body.days;
  assert.equal(plain.length, 14);
  assert.equal(plain[0].date, DATE);
  assert.equal(plain[13].date, "2030-04-27");
  assert.equal((await stats(ctx, { days: "500" })).body.days.length, 60);
  assert.equal((await stats(ctx, { days: "nonsense" })).body.days.length, 14);
});

// ---- the owner's view of one day's play ----

const dayView = async ({ app }, query = {}) => app({ method: "GET", path: "/v1/day", query: { key: KEY, date: DATE, ...query } });

test("the owner's day shows the board, what players said, and what the judge decided", async () => {
  const ctx = setup({
    config: { statsKey: KEY, judgeDailyCap: 50 },
    judgeImpl: ({ text }) => {
      if (/^fox/i.test(text)) return { valid: true, canonical: "Foxtrot", rarity: 66, why: "fits" };
      if (text === "bravo c") return { valid: true, canonical: "Bravo Charlie", rarity: 30, why: "same thing" };
      return { valid: false, canonical: null, rarity: 0, why: "Not a thing." };
    },
  });
  const [a, b, c, d, e] = [sid(), sid(), sid(), sid(), sid()];
  await ctx.answer(a, "p1", "Alpha");
  await ctx.answer(b, "p1", "a1"); // an alias of Alpha
  await ctx.answer(c, "p1", "nonsense"); // the judge turns it away
  await ctx.answer(c, "p1", "foxtrot!"); // a new answer
  await ctx.answer(d, "p1", "foxtrott"); // the same answer, misspelt: judged again, one row
  await ctx.answer(e, "p1", "bravo c"); // the judge lands it on an answer the bank has
  await ctx.answer(a, "p2", "Zulu");
  await ctx.post("/v1/finish", { date: DATE, session: a, name: "Ada" });

  const r = await dayView(ctx);
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  const { prompts, ...head } = r.body;
  assert.deepEqual(head, { date: DATE, round: 7, day: 2, players: 1, judge: { used: 4, cap: 50 }, board: [{ rank: 1, name: "Ada", score: 25 }] });
  assert.deepEqual(prompts[0], {
    id: "p1",
    q: "Name a thing",
    given: 5,
    distinct: 3,
    answers: [{ a: "Alpha", n: 2, pts: 10 }, { a: "Foxtrot", n: 2, pts: 66 }, { a: "Bravo Charlie", n: 1, pts: 40 }],
    accepted: [
      { a: "Bravo Charlie", pts: 40, bank: true, said: ["bravo c"], at: NOW },
      { a: "Foxtrot", pts: 66, bank: false, said: ["foxtrott"], at: NOW },
    ],
    refused: [{ text: "nonsense", why: "Not a thing.", at: NOW }],
  });
  assert.deepEqual(prompts[1], { id: "p2", q: "Another", given: 1, distinct: 1, answers: [{ a: "Zulu", n: 1, pts: 15 }], accepted: [], refused: [] });
  // No session ids, and nothing but the names players chose for the board.
  for (const s of [a, b, c, d, e]) assert.ok(!JSON.stringify(r.body).includes(s));
});

test("the owner's day needs the key, and an untouched day reads as empty", async () => {
  assert.equal((await dayView(setup())).status, 404); // no key configured
  const ctx = counted();
  assert.equal((await dayView(ctx, { key: "wrong" })).status, 404);
  assert.equal((await dayView(ctx, { date: "soon" })).status, 400);
  const r = await dayView(ctx, { date: "2030-05-02" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    date: "2030-05-02", round: 6, day: 1, players: 0, judge: { used: 0, cap: 2000 }, board: [],
    prompts: [{ id: "old", q: "Q", given: 0, distinct: 0, answers: [], accepted: [], refused: [] }],
  });
});
