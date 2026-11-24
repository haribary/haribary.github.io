// The Sloprillion API as a pure function: request in, response out. No AWS,
// no sockets. handler.mjs and local-server.mjs adapt it to Lambda and node:http.
//
// request  { method, path, query: {k: v}, body: string | object | undefined }
// response { status, headers, body }   (body is a plain object, serialised by the adapter)

import { timingSafeEqual } from "node:crypto";
import { buildIndex, match, matchWrong } from "../../src/match.js";
import { pickByDate, dayNumber } from "../../src/rounds/index.js";
import { cleanName } from "./names.mjs";
import { ALL_TIME, ownsBoardKey } from "./store-memory.mjs";
import { cleanSource } from "../../src/source.js";

const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 4096;

export const normKey = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);

const DEFAULTS = {
  judgeDailyCap: 2000,
  judgeSessionCap: 6, // judge calls per session per prompt
  maxAttempts: 12, // attempts per session per prompt
  judgeTimeoutMs: 6000,
  boardSize: 10, // rows on the leaderboard
  statsKey: "", // what GET /v1/stats must be asked with; empty turns it off
  pastDays: 7, // how far back a day can still be written to
};

const DAY_MS = 86400000;
const WHERE = new Set(["site", "game"]);
const OWNER_ROWS = 60; // rows per list in the owner's view of a day

function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function validDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = new Date(s + "T00:00:00Z");
  return !isNaN(t) && t.toISOString().slice(0, 10) === s;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function pickExamples(answers, n = 8) {
  const sorted = [...answers].sort((x, y) => x.pts - y.pts);
  if (sorted.length <= n) return sorted.map(({ a, pts }) => ({ a, pts }));
  const out = [];
  for (let k = 0; k < n; k++) {
    const { a, pts } = sorted[Math.round((k * (sorted.length - 1)) / (n - 1))];
    out.push({ a, pts });
  }
  return out;
}

export function createApp({ store, judge, rounds, now = Date.now, config = {} }) {
  const cfg = { ...DEFAULTS, ...config };
  const sorted = [...rounds].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!sorted.length) throw new Error("createApp needs at least one round");

  // Per-prompt lookup data, built the first time a round is played, so a cold
  // start costs the same however many rounds there are.
  const built = new Map(); // round id -> Map(prompt id -> { round, p, index, examples, stats, vk })
  function promptMeta(r, pid) {
    let byPid = built.get(r.id);
    if (!byPid) {
      byPid = new Map();
      for (const p of r.prompts) {
        const byPts = [...p.answers].sort((x, y) => x.pts - y.pts);
        const lo = byPts[0], hi = byPts[byPts.length - 1];
        byPid.set(p.id, {
          round: r,
          p,
          index: buildIndex(p),
          examples: pickExamples(p.answers),
          stats: { most: { a: lo.a, pts: lo.pts }, rarest: { a: hi.a, pts: hi.pts }, count: p.answers.length },
          vk: `${r.id}:${p.id}`,
        });
      }
      built.set(r.id, byPid);
    }
    return byPid.get(pid);
  }

  const utcDate = (offsetDays = 0) => new Date(now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

  const json = (status, body, headers = {}) => ({
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body,
  });

  function parseBody(req) {
    let b = req.body;
    if (b == null || b === "") throw bad("body required");
    if (typeof b === "string") {
      if (b.length > MAX_BODY) throw bad("body too large");
      try { b = JSON.parse(b); } catch { throw bad("body must be JSON"); }
    }
    if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("body must be an object");
    return b;
  }

  // A day and the round played on it (see pickByDate: once the rounds run
  // out they come round again). Everything stored is keyed by the day, not
  // the round, so a round's second outing starts with a clean tally.
  function needDay(v) {
    if (!validDate(v)) throw bad("date must be YYYY-MM-DD");
    return { date: v, round: pickByDate(sorted, v) };
  }
  // A day that can be written to. Players send their own calendar date, which
  // is at most a day ahead of UTC: anything later would let a future day's
  // round be played early. Days long past are closed too, so old days stay
  // as they ended and nobody can scatter data across the calendar.
  function needPlayDay(v) {
    const day = needDay(v);
    if (day.date > utcDate(1)) throw bad("date is in the future");
    if (day.date < utcDate(-cfg.pastDays)) throw bad("date is too far in the past");
    return day;
  }
  function needSession(v) {
    if (typeof v !== "string" || !SESSION_RE.test(v)) throw bad("session must be 8-64 chars of A-Z a-z 0-9 _ -");
    return v;
  }
  // The owner's routes: without the configured key they do not exist.
  function needKey(req) {
    if (!cfg.statsKey || !sameText(req.query?.key ?? "", cfg.statsKey)) throw new HttpError(404, "not found");
  }

  // ---- routes ----

  async function getRound(req) {
    const { date, round: r } = needDay(req.query?.date ?? utcDate());
    return json(200, {
      id: r.id,
      date,
      day: dayNumber(sorted, date),
      prompts: r.prompts.map(({ id, category, q, note }) => ({ id, category, q, note })),
    }, { "cache-control": "public, max-age=60" });
  }

  async function getDist(req) {
    const { date } = needDay(req.query?.date ?? utcDate());
    return json(200, await store.getDist(date));
  }

  // The leaderboard as a client sees it: the top rows of the all-time board,
  // which holds every day's entries, and where this session's game of `date`
  // stands if it is on the board. Board keys hold session ids, so they stay
  // here; `me` marks the caller's own rows, from any day, instead.
  async function boardFor(date, session) {
    const [top, mine] = await Promise.all([
      store.getBoardTop(ALL_TIME, cfg.boardSize),
      session ? store.getBoardEntry(date, session) : null,
    ]);
    let you = null;
    if (mine) {
      const at = top.findIndex((x) => x.key === mine.key);
      you = { rank: at >= 0 ? at + 1 : await store.getBoardRank(ALL_TIME, mine.key), name: mine.name, score: mine.score };
    }
    return {
      top: top.map((x, i) => ({ rank: i + 1, name: x.name, score: x.score, ...(session && ownsBoardKey(session, x.key) ? { me: true } : {}) })),
      you,
    };
  }

  async function getBoard(req) {
    const { date } = needDay(req.query?.date ?? utcDate());
    const session = req.query?.session ? needSession(req.query.session) : null;
    return json(200, { date, ...(await boardFor(date, session)) });
  }

  // One visit to the personal site or to the game, counted under where it
  // came from. Nothing about the visitor is stored: no id, no address, no
  // cookie. The page reports each browser once a day and a count goes up.
  async function postVisit(req) {
    const b = parseBody(req);
    const { date } = needPlayDay(b.date);
    const where = b.where === undefined ? "game" : b.where;
    if (!WHERE.has(where)) throw bad('where must be "site" or "game"');
    const src = cleanSource(b.src);
    if (!src) throw bad("src must be 1-40 characters of a-z 0-9 . _ -");
    await store.addSource(date, where, src);
    return json(200, { ok: true });
  }

  // The owner's numbers, newest day first: browsers that opened the site and
  // the game, and games finished, split by source. Asked for with the key the
  // function was configured with; without one the route does not exist.
  async function getStats(req) {
    needKey(req);
    const to = validDate(req.query?.to) ? req.query.to : utcDate();
    const count = clamp(Math.floor(Number(req.query?.days)) || 14, 1, 60);
    const end = Date.parse(to + "T00:00:00Z");
    const dates = Array.from({ length: count }, (_, i) => new Date(end - i * DAY_MS).toISOString().slice(0, 10));
    const days = await Promise.all(dates.map(async (date) => {
      const [bySrc, dist] = await Promise.all([store.getSources(date), store.getDist(date)]);
      const sources = Object.entries(bySrc)
        .map(([src, n]) => ({ src, site: n.site, game: n.game, finished: n.finished }))
        .sort((a, b) => b.site + b.game - (a.site + a.game) || b.finished - a.finished || (a.src < b.src ? -1 : 1));
      return {
        date,
        round: pickByDate(sorted, date).id,
        site: sources.reduce((n, x) => n + x.site, 0),
        game: sources.reduce((n, x) => n + x.game, 0),
        finished: dist.players,
        sources,
      };
    }));
    return json(200, { days });
  }

  // The owner's view of one day's play: the board, what players answered and
  // how often, and what the judge has decided for the round's prompts. Asked
  // for with the same key as the numbers.
  async function getDay(req) {
    needKey(req);
    const { date, round: r } = needDay(req.query?.date ?? utcDate());
    const [dist, counts, top, used, ...verdicts] = await Promise.all([
      store.getDist(date),
      store.listCounts(date),
      store.getBoardTop(date, cfg.boardSize),
      store.getJudgeUsed(date),
      ...r.prompts.map((p) => store.listVerdicts(`${r.id}:${p.id}`)),
    ]);
    const prompts = r.prompts.map((p, i) => {
      const m = promptMeta(r, p.id);
      const judged = judgedFor(m, verdicts[i]);
      const ruled = new Map(judged.accepted.map((x) => [normKey(x.a), x.pts]));
      const mine = counts.filter((c) => c.pid === p.id);
      const answers = mine
        .map(({ name, n }) => {
          const hit = match(m.index, name);
          return { a: name, n, pts: hit ? p.answers[hit.i].pts : ruled.get(normKey(name)) ?? null };
        })
        .sort((x, y) => y.n - x.n || (x.a < y.a ? -1 : 1));
      return {
        id: p.id,
        q: p.q,
        given: mine.reduce((sum, c) => sum + c.n, 0),
        distinct: answers.length,
        answers: answers.slice(0, OWNER_ROWS),
        accepted: judged.accepted.slice(0, OWNER_ROWS),
        refused: judged.refused.slice(0, OWNER_ROWS),
      };
    });
    return json(200, {
      date,
      round: r.id,
      day: dayNumber(sorted, date),
      players: dist.players,
      judge: { used, cap: cfg.judgeDailyCap },
      board: top.map((x, i) => ({ rank: i + 1, name: x.name, score: x.score })),
      prompts,
    });
  }

  // A prompt's cached verdicts as the owner reads them, newest first: the
  // answers the judge let in (one row per answer, with the spellings players
  // typed, and whether it landed on an answer the bank already had) and the
  // ones it turned away. A round keeps its verdicts for every day it is played.
  function judgedFor(m, list) {
    const accepted = new Map(), refused = [];
    for (const v of list) {
      const at = Number(v.at) || 0, said = String(v.text || v.key);
      if (!v.valid) {
        refused.push({ text: said, why: String(v.why || ""), at });
        continue;
      }
      const res = resolveVerdict(m, v);
      const k = normKey(res.a);
      const row = accepted.get(k) || { a: res.a, pts: res.pts, bank: res.bank, said: [], at: 0 };
      if (normKey(said) !== k && !row.said.includes(said) && row.said.length < 8) row.said.push(said);
      row.at = Math.max(row.at, at);
      accepted.set(k, row);
    }
    const newest = (x, y) => y.at - x.at || (String(x.a || x.text) < String(y.a || y.text) ? -1 : 1);
    return { accepted: [...accepted.values()].sort(newest), refused: refused.sort(newest) };
  }

  async function callJudge(args) {
    let timer;
    try {
      const v = await Promise.race([
        judge(args),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("judge timeout")), cfg.judgeTimeoutMs); }),
      ]);
      if (!v || typeof v.valid !== "boolean") throw new Error("judge returned a malformed verdict");
      if (v.valid && !Number.isFinite(Number(v.rarity))) throw new Error("judge returned no rarity");
      return v;
    } finally {
      clearTimeout(timer);
    }
  }

  // Resolve a verdict into a final answer: a bank answer, or a new one.
  function resolveVerdict(m, v) {
    const name = String(v.canonical || "").trim();
    if (name) {
      const hit = match(m.index, name);
      if (hit) {
        const b = m.p.answers[hit.i];
        return { a: b.a, pts: b.pts, fact: b.fact, bank: true };
      }
    }
    return { a: name, pts: v.pts, bank: false };
  }

  async function postAnswer(req) {
    const b = parseBody(req);
    const { date, round: r } = needPlayDay(b.date);
    const m = typeof b.promptId === "string" ? promptMeta(r, b.promptId) : null;
    if (!m) throw new HttpError(404, "unknown prompt");
    const session = needSession(b.session);
    const pid = m.p.id;
    const timeout = b.timeout === true;
    let text = "";
    if (!timeout) {
      if (typeof b.text !== "string") throw bad("text required");
      text = b.text.trim();
      if (text.length < 1 || text.length > 60) throw bad("text must be 1-60 characters");
    }

    const refuse = () => { throw bad("prompt already answered"); };
    const lockedMiss = async () => {
      if (!(await store.lock(date, pid, session, { a: null, pts: 0 }))) refuse();
      return json(200, { valid: false, locked: true, stats: m.stats });
    };

    if (timeout) {
      return lockedMiss(); // the conditional lock refuses if already locked
    }

    const st = await store.getState(date, pid, session); // read #1
    if (st?.locked) refuse();
    const attempts = st?.attempts || 0;
    const judgeCalls = st?.judgeCalls || 0;

    let final = null; // { a, pts, fact?, how }
    let usedJudge = false;

    const hit = match(m.index, text);
    const wrong = hit ? null : matchWrong(m.index, text); // a real answer always wins
    if (hit) {
      const ans = m.p.answers[hit.i];
      final = { a: ans.a, pts: ans.pts, fact: ans.fact, how: "bank" };
    } else if (wrong) {
      // Known wrong, with a reason: refuse it here. No cache lookup, no judge,
      // no budget spent; it still counts as an attempt below.
    } else {
      const key = normKey(text);
      if (key) {
        const cached = await store.getVerdict(m.vk, key);
        if (cached) {
          if (cached.valid) final = { ...resolveVerdict(m, cached), how: "cache" };
        } else if (judgeCalls < cfg.judgeSessionCap && (await store.takeJudgeBudget(utcDate(), cfg.judgeDailyCap))) {
          usedJudge = true;
          let v = null;
          try {
            v = await callJudge({ prompt: { id: pid, q: m.p.q, note: m.p.note, examples: m.examples }, text });
          } catch (e) {
            console.error("sloprillion judge failed:", e?.message); // nothing cached
          }
          if (v) final = await settleVerdict(m, key, text, v);
        }
      }
    }

    if (final) {
      if (!(await store.lock(date, pid, session, { a: final.a, pts: final.pts }))) refuse(); // write #1
      await store.incCount(date, pid, normKey(final.a), final.a); // write #2
      const out = { a: final.a, pts: final.pts };
      if (final.fact) out.fact = final.fact;
      return json(200, { valid: true, answer: out, how: final.how, stats: m.stats });
    }

    const n = await store.addAttempt(date, pid, session, { judge: usedJudge });
    if (n.attempts >= cfg.maxAttempts) return lockedMiss();
    return json(200, { valid: false, attemptsLeft: cfg.maxAttempts - n.attempts, ...(wrong && { why: wrong.why }) });
  }

  // Cache a fresh judge verdict and turn it into a final answer (or null).
  async function settleVerdict(m, key, text, v) {
    // `text` (what was typed) and `at` (when) are kept for the owner's view.
    if (!v.valid) {
      await store.putVerdict(m.vk, key, { valid: false, canonical: null, pts: 0, why: String(v.why || "").slice(0, 300), text, at: now() });
      return null;
    }
    const canonical = String(v.canonical || text).trim().slice(0, 60) || text;
    const pts = clamp(Math.round(Number(v.rarity)), 20, 95);
    const verdict = { valid: true, canonical, pts, why: String(v.why || "").slice(0, 300), text, at: now() };
    let res = resolveVerdict(m, verdict);
    if (!res.bank) {
      // Keep a new answer's points stable across spellings: if its canonical
      // name was already judged, reuse that verdict.
      const ck = normKey(canonical);
      if (ck && ck !== key) {
        const prior = await store.getVerdict(m.vk, ck);
        if (prior?.valid) {
          verdict.canonical = prior.canonical;
          verdict.pts = prior.pts;
          res = resolveVerdict(m, verdict);
        } else {
          await store.putVerdict(m.vk, ck, verdict);
        }
      }
    }
    await store.putVerdict(m.vk, key, verdict);
    return { ...res, how: "judge" };
  }

  async function postFinish(req) {
    const b = parseBody(req);
    const { date, round: r } = needPlayDay(b.date);
    const session = needSession(b.session);
    const locked = await store.listLocked(date, session);
    const byPid = new Map(locked.map((x) => [x.pid, x]));
    const results = r.prompts.map((p) => {
      const x = byPid.get(p.id);
      return { promptId: p.id, a: x ? x.a : null, pts: x ? x.pts : 0 };
    });
    const computed = results.reduce((s, x) => s + x.pts, 0);
    const fin = await store.finishSession(date, session, computed);
    // Credit the finished game to where the player came from. A page too old
    // to say counts as "unknown", so the sources still add up to the players.
    if (fin.first) {
      try {
        await store.addSource(date, "finished", cleanSource(b.src) || "unknown");
      } catch (e) {
        console.error("sloprillion source count failed:", e?.message); // never worth failing a finish over
      }
    }
    const dist = await store.getDist(date);
    const bucket = clamp(Math.floor(fin.score / 10), 0, 70);
    let below = 0;
    for (let i = 0; i < bucket; i++) below += dist.counts[i];
    const ahead = dist.players ? (below + dist.counts[bucket] / 2) / dist.players : 0;
    // A name puts the day's game on the leaderboard, once. Finishing again
    // with a name is how a player who skipped it, or whose name was refused,
    // gets on the board later; the score is always the one first stored.
    let nameError;
    if (b.name != null && b.name !== "") {
      const name = cleanName(b.name);
      if (name.ok) await store.postBoard(date, session, name.name, now());
      else nameError = name.reason;
    }
    const board = await boardFor(date, session);
    return json(200, { score: fin.score, results, dist, ahead, board, ...(nameError ? { nameError } : {}) });
  }

  async function route(req) {
    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || "/").replace(/\/+$/, "") || "/";
    if (method === "OPTIONS") return { status: 204, headers: {}, body: null };
    if (method === "GET" && path === "/v1/round") return getRound(req);
    if (method === "GET" && path === "/v1/dist") return getDist(req);
    if (method === "GET" && path === "/v1/board") return getBoard(req);
    if (method === "POST" && path === "/v1/answer") return postAnswer(req);
    if (method === "POST" && path === "/v1/finish") return postFinish(req);
    if (method === "POST" && path === "/v1/visit") return postVisit(req);
    if (method === "GET" && path === "/v1/stats") return getStats(req);
    if (method === "GET" && path === "/v1/day") return getDay(req);
    throw new HttpError(404, "not found");
  }

  async function handle(req) {
    try {
      return await route(req);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error("sloprillion error:", e?.message || e);
      return json(500, { error: "internal error" });
    }
  }
  handle.handle = handle; // works as `app(req)` and `app.handle(req)`
  return handle;
}
