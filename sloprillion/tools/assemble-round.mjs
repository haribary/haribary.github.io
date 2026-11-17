// Builds one round file from answer-set modules (the "parts"), in the same
// hand-readable style as src/rounds/001.js: unquoted keys, one answer per line.
//
//   node tools/assemble-round.mjs <id> <date> [--wrong=<file>] <part files in order>
//   node tools/assemble-round.mjs 2 2026-11-18 --wrong=src/rounds/parts/wrong.js src/rounds/parts/002-*.js
//
// Each part is a module whose default export is one prompt. --wrong names a
// module that maps prompt ids to lists of { a, alt?, why }; each list is merged
// into the prompt with that id as its `wrong` field. Ids that belong to other
// rounds are ignored. Output goes to src/rounds/<id padded to 3>.js.

import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const str = (s) => JSON.stringify(s);
const list = (a) => `[${a.map(str).join(", ")}]`;
const KEYS = { answer: ["a", "pts", "alt", "fact"], wrong: ["a", "alt", "why"] };

// One `{ a: "x", pts: 10, alt: [...] }` line. Fields come out in a fixed order.
function line(entry, kind) {
  for (const k of Object.keys(entry)) if (!KEYS[kind].includes(k)) throw new Error(`unknown ${kind} field "${k}" in ${str(entry.a)}`);
  const parts = KEYS[kind].filter((k) => entry[k] !== undefined).map((k) => {
    const v = entry[k];
    return `${k}: ${k === "pts" ? v : k === "alt" ? list(v) : str(v)}`;
  });
  return `{ ${parts.join(", ")} }`;
}

// The `wrong: [...]` block of a prompt, indented to sit inside it.
export function formatWrong(wrong, indent = "      ") {
  return `${indent}wrong: [\n${wrong.map((w) => `${indent}  ${line(w, "wrong")},\n`).join("")}${indent}],\n`;
}

function formatPrompt(p) {
  const known = ["id", "category", "q", "note", "exact", "people", "ignore", "answers", "wrong"];
  for (const k of Object.keys(p)) if (!known.includes(k)) throw new Error(`unknown prompt field "${k}" in ${p.id}`);
  let out = "    {\n";
  for (const k of ["id", "category", "q", "note"]) if (p[k] !== undefined) out += `      ${k}: ${str(p[k])},\n`;
  for (const k of ["exact", "people"]) if (p[k] !== undefined) out += `      ${k}: ${p[k]},\n`;
  if (p.ignore !== undefined) out += `      ignore: ${list(p.ignore)},\n`;
  out += `      answers: [\n${p.answers.map((a) => `        ${line(a, "answer")},\n`).join("")}      ],\n`;
  if (p.wrong?.length) out += formatWrong(p.wrong);
  return out + "    },\n";
}

export function formatRound(round) {
  return `export default {\n  id: ${round.id},\n  date: ${str(round.date)},\n  prompts: [\n${round.prompts.map(formatPrompt).join("")}  ],\n};\n`;
}

const load = async (file) => (await import(pathToFileURL(resolve(file)).href)).default;

async function main(argv) {
  const wrongArg = argv.find((a) => a.startsWith("--wrong="));
  const [id, date, ...files] = argv.filter((a) => !a.startsWith("--"));
  if (!/^\d+$/.test(id || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !files.length) {
    console.error("usage: node tools/assemble-round.mjs <id> <date> [--wrong=<file>] <part files in order>");
    process.exit(2);
  }
  const wrong = wrongArg ? await load(wrongArg.slice(8)) : {};
  const prompts = [];
  for (const f of files) prompts.push({ ...(await load(f)) });
  const used = [];
  for (const p of prompts) {
    if (wrong[p.id]) { p.wrong = wrong[p.id]; used.push(p.id); }
  }
  const dup = prompts.find((p, i) => prompts.findIndex((q) => q.id === p.id) !== i);
  if (dup) throw new Error(`prompt id "${dup.id}" appears twice`);
  const outFile = fileURLToPath(new URL(`../src/rounds/${id.padStart(3, "0")}.js`, import.meta.url));
  writeFileSync(outFile, formatRound({ id: Number(id), date, prompts }));
  console.log(`wrote ${outFile}`);
  prompts.forEach((p) => console.log(`  ${p.id}: ${p.answers.length} answers${p.wrong ? `, ${p.wrong.length} wrong` : ""}`));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
