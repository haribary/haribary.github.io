// Answer checking. Everything here is a lookup against a precomputed set, so a
// verdict is instant: no network, no model.
//
// A prompt's answers are turned into two maps of normalised keys:
//   exact  names and aliases as the author wrote them
//   loose  keys derived by rule (ignored words dropped, bare surnames)
// Authored keys always win over derived ones, and a derived key that points at
// two different answers is thrown away.
//
// A prompt may also list `wrong` answers, ones players commonly try that do not
// qualify, each with the reason. They get the same two maps, but a real answer
// always wins over them and they are never matched fuzzily.

function tokens(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")   // so "C++" and "g++" are not the same answer as "C" and "g"
    .replace(/#/g, " sharp ")   // likewise "C#" and "F#"
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Every key a string can be matched under. The first one is the plain form.
function variants(str, ignore) {
  const t = tokens(str);
  const out = new Set();
  if (!t.length) return out;
  out.add(t.join(""));
  if (t.length > 1 && /^(the|a|an)$/.test(t[0])) out.add(t.slice(1).join(""));
  if (ignore.length) {
    const kept = t.filter((w) => !ignore.includes(w));
    if (kept.length && kept.length < t.length) out.add(kept.join(""));
    // An ignored word glued on as a suffix: "quicksort" also answers to "quick".
    for (const k of [...out]) {
      for (const w of ignore) if (k.endsWith(w) && k.length - w.length >= 3) out.add(k.slice(0, -w.length));
    }
  }
  return out;
}

function surname(name) {
  const parts = String(name).trim().split(/\s+/);
  while (parts.length > 1 && /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.length < 2 ? "" : tokens(parts[parts.length - 1]).join("");
}

// Two maps of normalised keys for a list of { a, alt? } entries, as described above.
function indexEntries(entries, prompt, ignore) {
  const exact = new Map();
  const loose = new Map();
  const put = (map, k, i) => {
    if (!map.has(k)) map.set(k, i);
    else if (map.get(k) !== i) map.set(k, -1);
  };
  entries.forEach((ans, i) => {
    for (const name of [ans.a, ...(ans.alt || [])]) {
      const [primary, ...rest] = variants(name, ignore);
      if (primary) put(exact, primary, i);
      rest.forEach((k) => put(loose, k, i));
    }
    if (prompt.people) {
      const s = surname(ans.a);
      if (s) put(loose, s, i);
    }
  });
  return { exact, loose };
}

export function buildIndex(prompt) {
  const ignore = prompt.ignore || [];
  const { exact, loose } = indexEntries(prompt.answers, prompt, ignore);
  for (const [k, i] of exact) {
    if (i < 0) {
      console.warn(`[sloprillion] "${k}" names two answers in "${prompt.id}"; dropped`);
      exact.delete(k);
    }
  }
  for (const [k, i] of loose) if (i < 0 || exact.has(k)) loose.delete(k);

  // Wrong answers: same rules, then anything a real answer also claims is dropped.
  const wrong = indexEntries(prompt.wrong || [], prompt, ignore);
  for (const [k, i] of wrong.exact) {
    if (i < 0) {
      console.warn(`[sloprillion] "${k}" names two wrong answers in "${prompt.id}"; dropped`);
      wrong.exact.delete(k);
    } else if (exact.has(k) || loose.has(k)) {
      console.warn(`[sloprillion] "${k}" is both a wrong answer and an answer in "${prompt.id}"; wrong one dropped`);
      wrong.exact.delete(k);
    }
  }
  // A derived key (surname, ignored words dropped) that a real answer or an
  // authored wrong key also uses is not worth keeping, and says nothing.
  for (const [k, i] of wrong.loose) if (i < 0 || wrong.exact.has(k) || exact.has(k) || loose.has(k)) wrong.loose.delete(k);

  return { exact, loose, ignore, fuzzy: !prompt.exact, wrong: { ...wrong, list: prompt.wrong || [] } };
}

// Optimal string alignment distance, cut off once it exceeds `max`.
function distance(a, b, max) {
  const m = a.length, n = b.length;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

// Returns { i, how } for the matched answer, or null.
export function match(index, input) {
  const cands = [...variants(input, index.ignore)];
  if (!cands.length) return null;
  for (const map of [index.exact, index.loose]) {
    for (const k of cands) {
      const i = map.get(k);
      if (i !== undefined) return { i, how: "exact" };
    }
  }
  if (!index.fuzzy) return null;

  // Typos: one slip in a medium word, two in a long one, never in a short one.
  let best = null, bestD = 99, tie = false;
  for (const k of cands) {
    const max = k.length >= 9 ? 2 : k.length >= 5 ? 1 : 0;
    if (!max) continue;
    for (const map of [index.exact, index.loose]) {
      for (const [key, i] of map) {
        if (key.length < 5 || Math.abs(key.length - k.length) > max) continue;
        const d = distance(k, key, max);
        if (d > max) continue;
        if (d < bestD) { best = i; bestD = d; tie = false; }
        else if (d === bestD && i !== best) tie = true;
      }
    }
  }
  return best !== null && !tie ? { i: best, how: "typo" } : null;
}

// A known-wrong answer: { a, why } for the entry the input names, or null. Call
// it only after match() has missed, so a real answer always wins. Exact keys
// only; a typo of a wrong answer is no more informative than any other miss.
export function matchWrong(index, input) {
  const w = index.wrong;
  if (!w.list.length) return null;
  const cands = [...variants(input, index.ignore)];
  for (const map of [w.exact, w.loose]) {
    for (const k of cands) {
      const i = map.get(k);
      if (i !== undefined) return { a: w.list[i].a, why: w.list[i].why };
    }
  }
  return null;
}
