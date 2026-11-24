// The network side of the game. Everything here is optional: createApi()
// returns null unless an API address is configured, and every call fails soft
// (null or false) so main.js can carry on with local behaviour.

const LOCAL = "http://localhost:8787";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SESSION_KEY = "sloprillion:session";
const CHECK_MS = 8000; // longest a player waits on the server for one answer

// ?api=<url> (or ?api=local) wins, then <meta name="sloprillion-api">, else off.
// ?api=off forces local mode even when the page names a server (tests use it).
function apiBase(query) {
  const raw = query.get("api") || document.querySelector('meta[name="sloprillion-api"]')?.content || "";
  if (raw.trim() === "off") return "";
  const url = raw.trim() === "local" ? LOCAL : raw.trim();
  return url ? url.replace(/\/+$/, "") : "";
}

// 22 random URL-safe characters, kept so a reload is still the same player.
let memorySession = "";
function sessionId() {
  try {
    const kept = localStorage.getItem(SESSION_KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
  } catch { /* storage blocked: use the in-memory id */ }
  if (!memorySession) {
    const bytes = crypto.getRandomValues(new Uint8Array(22));
    memorySession = Array.from(bytes, (b) => ALPHABET[b & 63]).join("");
    try { localStorage.setItem(SESSION_KEY, memorySession); } catch { /* same */ }
  }
  return memorySession;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `date` is the day the game counts for: the player's own calendar date.
export function createApi(date, query) {
  const base = apiBase(query);
  if (!base) return null;
  // A page on localhost talking to the live server is someone working on the
  // game: its visits stay out of the live counts.
  const devOnLive = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(base + "/");
  const session = sessionId();
  const pending = new Set(); // background writes, so finish() can let them land first

  // POST JSON. Resolves to the parsed body on a 2xx, throws otherwise.
  async function post(path, body, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, session, ...body }),
        signal: ctl.signal,
      });
      if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status });
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  // Fire and forget, with one retry. A 4xx is the server's final word, so only
  // network errors and 5xx are worth a second try.
  function background(body) {
    const job = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await post("/v1/answer", body, 10000); return; } catch (e) {
          if (e.status && e.status < 500) return;
          await sleep(1500);
        }
      }
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  }

  return {
    // A bank hit the page already scored: tell the server, never wait for it.
    record: (promptId, text) => background({ promptId, text }),
    // Time ran out on this prompt.
    timedOut: (promptId) => background({ promptId, timeout: true }),

    // Ask about an answer the bank does not know. Resolves to the server's
    // verdict ({ valid: true, answer } / { valid: false } / { locked: true }),
    // or null on any failure or after 8 seconds.
    async check(promptId, text) {
      try {
        const r = await post("/v1/answer", { promptId, text }, CHECK_MS);
        if (r && r.valid === true && r.answer && typeof r.answer.a === "string" && Number.isFinite(r.answer.pts)) return r;
        if (r && r.locked === true) return r;
        if (r && r.valid === false) return r;
      } catch { /* fall through */ }
      return null;
    },

    // Count this visit under where it came from (see visits.js). Never waited for.
    visit(src) {
      if (devOnLive) return;
      post("/v1/visit", { where: "game", src }, 10000).catch(() => { /* the count is optional */ });
    },

    // End of game: the server's score, the day's tally and the leaderboard, or
    // null. A name puts the result on the board; finishing again with a name
    // adds one to a result that has none, and never changes the score. `src`
    // credits the finished game to where the player came from.
    async finish(name, src) {
      await Promise.race([Promise.allSettled([...pending]), sleep(4000)]); // let the answers land first
      try {
        const r = await post("/v1/finish", { ...(name ? { name } : {}), ...(src ? { src } : {}) }, 10000);
        if (r && Number.isFinite(r.score) && r.dist && Array.isArray(r.dist.counts)) return r;
      } catch { /* fall back to the estimate */ }
      return null;
    },

    // The leaderboard ({ top, you }): the best results of any day, with this
    // player's own rows marked and where today's game stands, or null.
    async board() {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(`${base}/v1/board?date=${date}&session=${session}`, { signal: ctl.signal });
        const r = res.ok ? await res.json() : null;
        if (r && Array.isArray(r.top)) return r;
      } catch { /* the board is optional */ } finally { clearTimeout(timer); }
      return null;
    },
  };
}
