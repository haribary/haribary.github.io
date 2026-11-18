// In-memory store for tests and local dev. Same interface as store-dynamo.mjs
// (see that file for the key layout); the behaviour suite in test/ runs on both.

const BUCKETS = 71;

// Where a leaderboard entry sorts: best score first, then whoever finished
// first, as a string that orders correctly as plain text. The session at the
// end keeps two entries from ever sharing a key; it is never sent to a client.
export const boardKey = (score, at, session) =>
  `${String(999 - score).padStart(3, "0")}#${String(Math.floor(at)).padStart(13, "0")}#${session}`;

export function createMemoryStore() {
  const boards = new Map(); // date -> Map(session -> { name, score, key })
  const states = new Map(); // "date|session|pid" -> { attempts, judgeCalls, locked, a, pts }
  const verdicts = new Map(); // "vk|key" -> verdict
  const budget = new Map(); // date -> calls
  const counts = new Map(); // "date|pid|canonKey" -> { name, n }
  const finished = new Map(); // "date|session" -> score
  const hist = new Map(); // date -> { players, b: number[71] }

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

    // Put a finished session on the day's leaderboard under a name. Once per
    // session: the first name stays. Returns { first, entry } with entry as
    // { name, score, key }, or null if the session has not finished.
    async postBoard(date, session, name, at) {
      const fk = `${date}|${session}`;
      if (!finished.has(fk)) return null;
      const day = boards.get(date) || new Map();
      boards.set(date, day);
      if (day.has(session)) return { first: false, entry: { ...day.get(session) } };
      const score = finished.get(fk);
      const entry = { name, score, key: boardKey(score, at, session) };
      day.set(session, entry);
      return { first: true, entry: { ...entry } };
    },

    async getBoardEntry(date, session) {
      const entry = boards.get(date)?.get(session);
      return entry ? { ...entry } : null;
    },

    // The best `limit` entries, best first.
    async getBoardTop(date, limit) {
      return [...(boards.get(date)?.values() || [])]
        .sort((a, b) => (a.key < b.key ? -1 : 1))
        .slice(0, limit)
        .map((entry) => ({ ...entry }));
    },

    // 1 for the best entry of the day.
    async getBoardRank(date, key) {
      let rank = 1;
      for (const entry of boards.get(date)?.values() || []) if (entry.key < key) rank += 1;
      return rank;
    },
  };
}
