// Validates answer sets. Give it a round file (default export with `prompts`)
// or a single prompt module (default export with `answers`).
//
//   node tools/check-round.mjs src/rounds/001.js
//   node tools/check-round.mjs path/to/one-prompt.js

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildIndex } from "../src/match.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/check-round.mjs <round or prompt file>");
  process.exit(2);
}

const mod = (await import(pathToFileURL(resolve(file)).href)).default;
const prompts = Array.isArray(mod?.prompts) ? mod.prompts : [mod];
const BANDS = [[10, 24], [25, 44], [45, 64], [65, 84], [85, 99], [100, 100]];
let failed = 0;

for (const p of prompts) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);

  for (const key of ["id", "category", "q"]) if (typeof p?.[key] !== "string" || !p[key]) err(`missing string field "${key}"`);
  if (p.note !== undefined && typeof p.note !== "string") err(`"note" must be a string`);
  if (!Array.isArray(p?.answers) || !p.answers.length) {
    err("no answers");
  } else {
    let prev = 0;
    const seen = new Set();
    p.answers.forEach((x, i) => {
      const where = `answer ${i + 1} (${x?.a ?? "?"})`;
      if (typeof x.a !== "string" || !x.a.trim()) err(`${where}: missing name`);
      if (!Number.isInteger(x.pts) || x.pts < 10 || x.pts > 100) err(`${where}: pts must be an integer from 10 to 100`);
      if (x.pts < prev) err(`${where}: out of order, pts ${x.pts} follows ${prev}`);
      prev = x.pts;
      if (seen.has(x.a)) err(`${where}: duplicate name`);
      seen.add(x.a);
      if (x.alt !== undefined && (!Array.isArray(x.alt) || x.alt.some((s) => typeof s !== "string" || !s.trim()))) err(`${where}: alt must be an array of strings`);
      if (x.alt?.some((s) => s !== s.toLowerCase())) warnings.push(`${where}: aliases should be lowercase`);
      if (x.fact !== undefined && (typeof x.fact !== "string" || x.fact.length > 90)) err(`${where}: fact is ${x.fact?.length} characters, the limit is 90`);
      if (x.pts >= 85 && !x.fact) err(`${where}: answers worth 85 or more need a fact`);
      for (const k of Object.keys(x)) if (!["a", "pts", "alt", "fact"].includes(k)) err(`${where}: unknown field "${k}"`);
    });
    const jackpots = p.answers.filter((x) => x.pts === 100).length;
    if (jackpots !== 1) err(`there must be exactly one answer at 100, found ${jackpots}`);

    // Collisions: buildIndex warns when one key names two answers.
    const collisions = [];
    const realWarn = console.warn;
    console.warn = (...a) => collisions.push(a.join(" "));
    try { buildIndex(p); } finally { console.warn = realWarn; }
    collisions.forEach((c) => err(c.replace("[sloprillion] ", "collision: ")));

    // Known-wrong answers: { a, alt?, why }. A wrong entry that shares a key
    // with a real answer, or with another wrong entry, would never be reached
    // or would be ambiguous; buildIndex warns about both, as above.
    if (p.wrong !== undefined && !Array.isArray(p.wrong)) err(`"wrong" must be an array`);
    else (p.wrong || []).forEach((w, i) => {
      const where = `wrong ${i + 1} (${w?.a ?? "?"})`;
      if (!w || typeof w !== "object") return err(`${where}: must be an object`);
      if (typeof w.a !== "string" || !w.a.trim()) err(`${where}: missing name`);
      if (typeof w.why !== "string" || !w.why.trim()) err(`${where}: missing why`);
      else if (w.why.length > 80) err(`${where}: why is ${w.why.length} characters, the limit is 80`);
      if (w.alt !== undefined && (!Array.isArray(w.alt) || w.alt.some((s) => typeof s !== "string" || !s.trim() || s !== s.toLowerCase()))) err(`${where}: alt must be an array of lowercase strings`);
      for (const k of Object.keys(w)) if (!["a", "alt", "why"].includes(k)) err(`${where}: unknown field "${k}"`);
    });

    const n = p.answers.length;
    const perBand = BANDS.map(([lo, hi]) => p.answers.filter((x) => x.pts >= lo && x.pts <= hi).length);
    if (n < 80) warnings.push(`only ${n} answers; the target is 80 or more unless the set is genuinely closed`);
    if (perBand[0] > 8) warnings.push(`${perBand[0]} answers in 10 to 24; that band is for the 3 to 7 most obvious`);
    if (perBand[4] > n * 0.3) warnings.push(`${perBand[4]} of ${n} answers sit in 85 to 99; spread them down the range`);
    console.log(`${errors.length ? "FAIL" : "ok  "}  ${p.id}: ${n} answers, per band ${perBand.join(" / ")}`);
  }
  if (!Array.isArray(p?.answers) || !p.answers.length) console.log(`FAIL  ${p?.id ?? "(no id)"}`);
  errors.forEach((m) => console.log("   error: " + m));
  warnings.forEach((m) => console.log("   note:  " + m));
  if (errors.length) failed++;
}

process.exit(failed ? 1 : 0);
