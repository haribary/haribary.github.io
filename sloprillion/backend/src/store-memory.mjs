// In-memory store for tests and local dev. Same interface as store-dynamo.mjs
// (see that file for the key layout); the behaviour suite in test/ runs on both.

const BUCKETS = 71;

export function createMemoryStore() {
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
  };
}
