// In-memory store for tests and local dev. Same interface as store-dynamo.mjs
// (see that file for the key layout); the behaviour suite in test/ runs on both.

const BUCKETS = 71;

// Where a leaderboard entry sorts: best score first, then whoever finished
// first, as a string that orders correctly as plain text. The session at the
// end keeps two entries from ever sharing a key; it is never sent to a client.
export const boardKey = (score, at, session) =>
  `${String(999 - score).padStart(3, "0")}#${String(Math.floor(at)).padStart(13, "0")}#${session}`;

// Whether a board key is one of this session's (a session id holds no "#").
export const ownsBoardKey = (session, key) => key.endsWith("#" + session);

// Every entry goes on two boards: its day's, and this one, which holds every
// day's entries and is the board players see.
export const ALL_TIME = "ALL";

export function createMemoryStore() {
  const boards = new Map(); // board (a date, or ALL_TIME) -> Map(board key -> { name, score, key })
  const named = new Map(); // "date|session" -> the entry that day's game went on the boards as
  const states = new Map(); // "date|session|pid" -> { attempts, judgeCalls, locked, a, pts }
  const verdicts = new Map(); // "vk|key" -> verdict
  const budget = new Map(); // date -> calls
  const counts = new Map(); // "date|pid|canonKey" -> { name, n }
  const finished = new Map(); // "date|session" -> score
  const hist = new Map(); // date -> { players, b: number[71] }
  const sources = new Map(); // date -> Map(source -> { site, game, finished })

  const sk = (d, s, p) => `${d}|${s}|${p}`;

  return {
    async getState(date, pid, session) {
      const s = states.get(sk(date, session, pid));
      return s ? { ...s } : null;
    },

    async addAttempt(date, pid, session, { judge = false } = {}) {
      const k = sk(date, session, pid);
      const s = states.get(k) || { attempts: 0, judgeCalls: 0, locked: false };
      s.attempts += 1;
      if (judge) s.judgeCalls += 1;
      states.set(k, s);
      return { attempts: s.attempts, judgeCalls: s.judgeCalls };
    },

    // First lock wins. a is null for a miss.
    async lock(date, pid, session, { a, pts }) {
      const k = sk(date, session, pid);
      const s = states.get(k) || { attempts: 0, judgeCalls: 0, locked: false };
      if (s.locked) return false;
      s.locked = true;
      s.a = a;
      s.pts = pts;
      states.set(k, s);
      return true;
    },

    async listLocked(date, session) {
      const out = [];
      const prefix = `${date}|${session}|`;
      for (const [k, s] of states) {
        if (k.startsWith(prefix) && s.locked) out.push({ pid: k.slice(prefix.length), a: s.a, pts: s.pts });
      }
      return out;
    },

    async getVerdict(vk, key) {
      const v = verdicts.get(`${vk}|${key}`);
      return v ? { ...v } : null;
    },
    async putVerdict(vk, key, verdict) {
      verdicts.set(`${vk}|${key}`, { ...verdict });
    },

    // Atomically take one judge call from the day's budget.
    async takeJudgeBudget(date, cap) {
      const n = budget.get(date) || 0;
      if (n >= cap) return false;
      budget.set(date, n + 1);
      return true;
    },

    async incCount(date, pid, canonKey, name) {
      const k = `${date}|${pid}|${canonKey}`;
      const c = counts.get(k) || { name, n: 0 };
      c.n += 1;
      counts.set(k, c);
    },
    // Not part of the Dynamo interface's API surface for the app; for tests.
    async getCount(date, pid, canonKey) {
      return counts.get(`${date}|${pid}|${canonKey}`)?.n || 0;
    },

    // Finish once per session. Returns { first, score } (score as first stored).
    async finishSession(date, session, score) {
      const k = `${date}|${session}`;
      if (finished.has(k)) return { first: false, score: finished.get(k) };
      finished.set(k, score);
      const h = hist.get(date) || { players: 0, b: new Array(BUCKETS).fill(0) };
      h.players += 1;
      h.b[Math.min(BUCKETS - 1, Math.max(0, Math.floor(score / 10)))] += 1;
      hist.set(date, h);
      return { first: true, score };
    },

    async getDist(date) {
      const h = hist.get(date);
      return h ? { counts: [...h.b], players: h.players } : { counts: new Array(BUCKETS).fill(0), players: 0 };
    },

    // Put a day's finished session on the leaderboards (the day's own and the
    // all-time one) under a name. Once per session per day: the first name
    // stays. Returns { first, entry } with entry as { name, score, key }, or
    // null if the session has not finished.
    async postBoard(date, session, name, at) {
      const fk = `${date}|${session}`;
      if (!finished.has(fk)) return null;
      if (named.has(fk)) return { first: false, entry: { ...named.get(fk) } };
      const score = finished.get(fk);
      const entry = { name, score, key: boardKey(score, at, session) };
      named.set(fk, entry);
      for (const board of [date, ALL_TIME]) {
        if (!boards.has(board)) boards.set(board, new Map());
        boards.get(board).set(entry.key, entry);
      }
      return { first: true, entry: { ...entry } };
    },

    async getBoardEntry(date, session) {
      const entry = named.get(`${date}|${session}`);
      return entry ? { ...entry } : null;
    },

    // The best `limit` entries of a board (a date, or ALL_TIME), best first.
    async getBoardTop(board, limit) {
      return [...(boards.get(board)?.values() || [])]
        .sort((a, b) => (a.key < b.key ? -1 : 1))
        .slice(0, limit)
        .map((entry) => ({ ...entry }));
    },

    // 1 for the best entry on the board.
    async getBoardRank(board, key) {
      let rank = 1;
      for (const entry of boards.get(board)?.values() || []) if (entry.key < key) rank += 1;
      return rank;
    },

    // Add one to a day's count for a source label. `kind` is "site" (a visit
    // to the personal site), "game" (a visit to the game) or "finished" (a
    // completed game).
    async addSource(date, kind, src) {
      const day = sources.get(date) || new Map();
      sources.set(date, day);
      const row = day.get(src) || { site: 0, game: 0, finished: 0 };
      row[kind] += 1;
      day.set(src, row);
    },

    // The day's counts: { <source>: { site, game, finished } }.
    async getSources(date) {
      const out = {};
      for (const [src, row] of sources.get(date) || []) out[src] = { ...row };
      return out;
    },

    // ---- the owner's views: read-only, never reached by a player ----

    // How many judge calls a day has used.
    async getJudgeUsed(date) {
      return budget.get(date) || 0;
    },

    // Every accepted answer of a day with how often it was given: [{ pid, name, n }].
    async listCounts(date) {
      const out = [], prefix = `${date}|`;
      for (const [k, c] of counts) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        out.push({ pid: rest.slice(0, rest.indexOf("|")), name: c.name, n: c.n });
      }
      return out;
    },

    // Every cached verdict for a prompt: [{ key, ...verdict }].
    async listVerdicts(vk) {
      const out = [], prefix = `${vk}|`;
      for (const [k, v] of verdicts) if (k.startsWith(prefix)) out.push({ key: k.slice(prefix.length), ...v });
      return out;
    },
  };
}
