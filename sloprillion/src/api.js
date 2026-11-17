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

export function createApi(round, query) {
  const base = apiBase(query);
  if (!base) return null;
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
        body: JSON.stringify({ date: round.date, session, ...body }),
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

    // End of game: the server's score and the day's tally, or null.
    async finish() {
      await Promise.race([Promise.allSettled([...pending]), sleep(4000)]); // let the answers land first
      try {
        const r = await post("/v1/finish", {}, 10000);
        if (r && Number.isFinite(r.score) && r.dist && Array.isArray(r.dist.counts)) return r;
      } catch { /* fall back to the estimate */ }
      return null;
    },
  };
}
