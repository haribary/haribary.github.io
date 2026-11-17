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
let n = 0;
const sid = () => "sess" + String(++n).padStart(6, "0");

function setup({ judgeImpl, config } = {}) {
  const store = createMemoryStore();
  const calls = [];
  const judge = async (args) => {
    calls.push(args);
    return judgeImpl ? judgeImpl(args) : { valid: false, canonical: null, rarity: 10, why: "no" };
  };
  const app = createApp({ store, judge, rounds: [earlier, round], config });
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

test("round fallback: latest on or before, else earliest", async () => {
  const { app } = setup();
  const get = (date) => app({ method: "GET", path: "/v1/round", query: { date } });
  assert.equal((await get("2030-12-31")).body.date, DATE);
  assert.equal((await get("2030-05-05")).body.date, "2030-05-01");
  assert.equal((await get("2020-01-01")).body.date, "2030-05-01");
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
  const app = createApp({ store, judge: async () => ({}), rounds: [round] });
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
  let app;
  try { app = createApp({ store: createMemoryStore(), judge: async () => ({ valid: false }), rounds: [clash] }); } finally { console.warn = orig; }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /"alpha" is both a wrong answer and an answer/);
  const ask = (text) => app({ method: "POST", path: "/v1/answer", body: { date: "2031-01-01", promptId: "c", session: sid(), text } });
  assert.equal((await ask("alpha")).body.valid, true);
  assert.equal((await ask("beta")).body.why, "Nope.");
});
