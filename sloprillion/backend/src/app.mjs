// The Sloprillion API as a pure function: request in, response out. No AWS,
// no sockets. handler.mjs and local-server.mjs adapt it to Lambda and node:http.
//
// request  { method, path, query: {k: v}, body: string | object | undefined }
// response { status, headers, body }   (body is a plain object, serialised by the adapter)

import { buildIndex, match, matchWrong } from "../../src/match.js";

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
};

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

  // Per-prompt precomputed data, built once per cold start.
  const meta = new Map(); // "date/pid" -> { round, p, index, examples, stats, vk }
  for (const r of sorted) {
    for (const p of r.prompts) {
      const byPts = [...p.answers].sort((x, y) => x.pts - y.pts);
      const lo = byPts[0], hi = byPts[byPts.length - 1];
      meta.set(`${r.date}/${p.id}`, {
        round: r,
        p,
        index: buildIndex(p),
        examples: pickExamples(p.answers),
        stats: { most: { a: lo.a, pts: lo.pts }, rarest: { a: hi.a, pts: hi.pts }, count: p.answers.length },
        vk: `${r.id}:${p.id}`,
      });
    }
  }

  function resolveRound(date) {
    let pick = sorted[0];
    for (const r of sorted) if (r.date <= date) pick = r;
    return pick;
  }

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

  function needDate(v) {
    if (!validDate(v)) throw bad("date must be YYYY-MM-DD");
    return resolveRound(v);
  }
  function needSession(v) {
    if (typeof v !== "string" || !SESSION_RE.test(v)) throw bad("session must be 8-64 chars of A-Z a-z 0-9 _ -");
    return v;
  }

  // ---- routes ----

  async function getRound(req) {
    const d = req.query?.date ?? new Date(now()).toISOString().slice(0, 10);
    const r = needDate(d);
    return json(200, {
      id: r.id,
      date: r.date,
      prompts: r.prompts.map(({ id, category, q, note }) => ({ id, category, q, note })),
    }, { "cache-control": "public, max-age=60" });
  }

  async function getDist(req) {
    const r = needDate(req.query?.date ?? new Date(now()).toISOString().slice(0, 10));
    return json(200, await store.getDist(r.date));
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
    const r = needDate(b.date);
    const m = meta.get(`${r.date}/${b.promptId}`);
    if (typeof b.promptId !== "string" || !m) throw new HttpError(404, "unknown prompt");
    const session = needSession(b.session);
    const date = r.date, pid = m.p.id;
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
        } else if (judgeCalls < cfg.judgeSessionCap && (await store.takeJudgeBudget(date, cfg.judgeDailyCap))) {
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
    if (!v.valid) {
      await store.putVerdict(m.vk, key, { valid: false, canonical: null, pts: 0, why: String(v.why || "").slice(0, 300) });
      return null;
    }
    const canonical = String(v.canonical || text).trim().slice(0, 60) || text;
    const pts = clamp(Math.round(Number(v.rarity)), 20, 95);
    const verdict = { valid: true, canonical, pts, why: String(v.why || "").slice(0, 300) };
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
    const r = needDate(b.date);
    const session = needSession(b.session);
    const locked = await store.listLocked(r.date, session);
    const byPid = new Map(locked.map((x) => [x.pid, x]));
    const results = r.prompts.map((p) => {
      const x = byPid.get(p.id);
      return { promptId: p.id, a: x ? x.a : null, pts: x ? x.pts : 0 };
    });
    const computed = results.reduce((s, x) => s + x.pts, 0);
    const fin = await store.finishSession(r.date, session, computed);
    const dist = await store.getDist(r.date);
    const bucket = clamp(Math.floor(fin.score / 10), 0, 70);
    let below = 0;
    for (let i = 0; i < bucket; i++) below += dist.counts[i];
    const ahead = dist.players ? (below + dist.counts[bucket] / 2) / dist.players : 0;
    return json(200, { score: fin.score, results, dist, ahead });
  }

  async function route(req) {
    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || "/").replace(/\/+$/, "") || "/";
    if (method === "OPTIONS") return { status: 204, headers: {}, body: null };
    if (method === "GET" && path === "/v1/round") return getRound(req);
    if (method === "GET" && path === "/v1/dist") return getDist(req);
    if (method === "POST" && path === "/v1/answer") return postAnswer(req);
    if (method === "POST" && path === "/v1/finish") return postFinish(req);
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
