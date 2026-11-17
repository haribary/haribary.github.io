// Applies fact-check findings (see tools/authoring/VERIFY.md) to a round file.
//
//   node tools/apply-review.mjs src/rounds/002.js tools/authoring/review/002-*.json [--dry]
//
// Each review file is named <round>-<prompt id>.json and holds an array of
// { a, verdict: "ok" | "fix-fact" | "remove" | "unsure", fact?, why?, source? }.
// "fix-fact" replaces the answer's fact; "remove" deletes the answer. The
// 100-point answer is never removed automatically (a prompt needs exactly one),
// and neither verdict is applied without a source. Everything skipped is listed.

import { pathToFileURL } from "node:url";
import { resolve, basename } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { formatRound } from "./assemble-round.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [roundFile, ...reviewFiles] = args.filter((a) => a !== "--dry");
if (!roundFile || !reviewFiles.length) {
  console.error("usage: node tools/apply-review.mjs <round file> <review json>... [--dry]");
  process.exit(2);
}

const round = structuredClone((await import(pathToFileURL(resolve(roundFile)).href)).default);
let changed = 0;

for (const file of reviewFiles) {
  const promptId = basename(file).replace(/^\d+-/, "").replace(/\.json$/, "");
  const prompt = round.prompts.find((p) => p.id === promptId);
  if (!prompt) { console.log(`skip ${file}: no prompt "${promptId}" in this round`); continue; }
  let findings;
  try { findings = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.log(`skip ${file}: ${e.message}`); continue; }
  const tally = { ok: 0, "fix-fact": 0, remove: 0, unsure: 0, skipped: 0 };
  for (const f of findings) {
    const i = prompt.answers.findIndex((x) => x.a === f.a);
    const skip = (why) => { tally.skipped++; console.log(`  ${promptId}: skipped ${f.verdict} for "${f.a}": ${why}`); };
    if (f.verdict === "ok" || f.verdict === "unsure") { tally[f.verdict]++; if (f.verdict === "unsure") console.log(`  ${promptId}: unsure about "${f.a}": ${f.why || ""}`); continue; }
    if (i < 0) { skip("no answer with that exact name"); continue; }
    if (!f.source) { skip("no source given"); continue; }
    if (f.verdict === "fix-fact") {
      if (typeof f.fact !== "string" || !f.fact.trim() || f.fact.length > 90) { skip("replacement fact missing or over 90 characters"); continue; }
      console.log(`  ${promptId}: fact for "${f.a}"\n      was: ${prompt.answers[i].fact ?? "(none)"}\n      now: ${f.fact}\n      why: ${f.why || ""} (${f.source})`);
      prompt.answers[i].fact = f.fact.trim();
      tally["fix-fact"]++; changed++;
    } else if (f.verdict === "remove") {
      if (prompt.answers[i].pts === 100) { skip("it is the 100-point answer; pick a new one by hand"); continue; }
      console.log(`  ${promptId}: removed "${f.a}": ${f.why || ""} (${f.source})`);
      prompt.answers.splice(i, 1);
      tally.remove++; changed++;
    } else skip(`unknown verdict "${f.verdict}"`);
  }
  console.log(`${promptId}: ${findings.length} checked: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")}`);
}

if (dry) console.log(`dry run: ${changed} change(s) not written`);
else if (changed) { writeFileSync(resolve(roundFile), formatRound(round)); console.log(`wrote ${roundFile} with ${changed} change(s)`); }
else console.log("nothing to change");
