// Benchmark runner. Usage (from sloprillion/):
//   node tools/judge-bench/run.mjs --provider openai --models a,b,c [--sample N] [--concurrency 4]
//        [--failed] [--tag name] [--extra '{"reasoning":{"effort":"low"}}'] [--timeout 3000] [--instruction file.txt]
// --sample N: deterministic stratified subset of N cases. --failed: only cases the model previously got wrong (plus the sample if given).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeJudge, pickExamples, PRICES } from "../../backend/src/judge.mjs";
import { buildIndex, match } from "../../src/match.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CAP = 8; // USD, across all runs
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const n = process.argv[i + 1];
    if (!n || n.startsWith("--")) args[k] = true;
    else { args[k] = n; i++; }
  }
}
const provider = args.provider || "openai";
const models = String(args.models || "").split(",").filter(Boolean);
if (!models.length && !args["report-only"]) { console.error("--models required"); process.exit(1); }
const conc = Number(args.concurrency || 4);
const tag = args.tag || "final";
const extra = args.extra ? JSON.parse(args.extra) : undefined;
const instruction = args.instruction ? fs.readFileSync(args.instruction, "utf8") : undefined;

let apiKey;
if (provider === "openai") {
  const env = fs.readFileSync(path.resolve(dir, "../../../.env"), "utf8");
  apiKey = env.match(/^OPENAI_API_KEY=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found");
}

const spendFile = path.join(dir, "spend.json");
const spend = fs.existsSync(spendFile) ? JSON.parse(fs.readFileSync(spendFile, "utf8")) : { total: 0, byModel: {} };
const saveSpend = () => fs.writeFileSync(spendFile, JSON.stringify(spend, null, 1));
let capHit = false;

const round = (await import(pathToFileURL(path.resolve(dir, "../../src/rounds/001.js")).href)).default;
const prompts = Object.fromEntries(round.prompts.map((p) => [p.id, p]));
const indexes = Object.fromEntries(round.prompts.map((p) => [p.id, buildIndex(p)]));
const allCases = JSON.parse(fs.readFileSync(path.join(dir, "cases.json"), "utf8")).map((c, i) => ({ ...c, id: i }));

// Calibration examples per prompt, excluding that prompt's held-out answers.
const examples = {};
for (const p of round.prompts) {
  const ex = new Set(allCases.filter((c) => c.promptId === p.id && c.kind === "held-out").map((c) => c.bank.toLowerCase()));
  examples[p.id] = pickExamples(p, 8, ex);
}

const resultsFile = path.join(dir, "results.json");
const store = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : { runs: [] };

function pick(cases, n) {
  if (!n || n >= cases.length) return cases;
  const h = (c) => (c.id * 2654435761) % 4294967296;
  const byKind = {};
  for (const c of [...cases].sort((a, b) => h(a) - h(b))) (byKind[c.kind] ||= []).push(c);
  const out = [];
  const kinds = Object.keys(byKind);
  for (let i = 0; out.length < n; i++) {
    let any = false;
    for (const k of kinds) if (byKind[k][i] && out.length < n) { out.push(byKind[k][i]); any = true; }
    if (!any) break;
  }
  return out;
}

async function runModel(model) {
  let cases = allCases;
  if (args.failed) {
    const bad = new Set(
      store.runs.filter((r) => r.model === model).flatMap((r) => r.records.filter((x) => x.error || x.valid !== (x.expect === "valid")).map((x) => x.id)),
    );
    const failed = allCases.filter((c) => bad.has(c.id));
    const sampled = args.sample ? pick(allCases, Number(args.sample)) : [];
    cases = [...new Map([...failed, ...sampled].map((c) => [c.id, c])).values()];
  } else if (args.sample) cases = pick(allCases, Number(args.sample));
  const judge = makeJudge({ provider, model, apiKey, timeoutMs: Number(args.timeout || 3000), extra, instruction });
  const records = new Array(cases.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= cases.length) return;
      const c = cases[i];
      if (spend.total >= CAP) { capHit = true; records[i] = null; continue; }
      const t0 = Date.now();
      const rec = { id: c.id, promptId: c.promptId, text: c.text, expect: c.expect, kind: c.kind };
      try {
        const v = await judge({ prompt: { id: c.promptId, q: prompts[c.promptId].q, note: prompts[c.promptId].note, examples: examples[c.promptId] }, text: c.text });
        Object.assign(rec, { valid: v.valid, canonical: v.canonical, rarity: v.rarity, why: v.why, ms: v.ms, usage: v.usage, cost: v.cost });
        // unpriced model: charge at gpt-6-sol rates to stay on the safe side
        const cost = v.cost ?? (v.usage.input * 2 + v.usage.output * 10) / 1e6;
        spend.total += cost;
        spend.byModel[model] = (spend.byModel[model] || 0) + cost;
        if (c.kind === "held-out") { rec.bank = c.bank; rec.pts = c.pts; }
      } catch (e) {
        rec.error = String(e.message).slice(0, 160);
        rec.ms = Date.now() - t0;
        if (/timeout/.test(rec.error)) rec.timeout = true;
      }
      records[i] = rec;
      if (++done % 50 === 0) { saveSpend(); process.stdout.write(`  ${model} ${done}/${cases.length} spend $${spend.total.toFixed(4)}\n`); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  saveSpend();
  return { model, tag, provider, extra: extra || null, custom_instruction: !!instruction, at: new Date().toISOString(), n: cases.length, records: records.filter(Boolean) };
}

function rank(a) {
  const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++;
    for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) {
  if (x.length < 3) return null;
  const a = rank(x), b = rank(y), n = a.length;
  const ma = a.reduce((s, v) => s + v) / n, mb = b.reduce((s, v) => s + v) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

function summarize(run) {
  const R = run.records, ok = R.filter((r) => !r.error);
  const correct = (r) => r.valid === (r.expect === "valid");
  const kinds = {};
  for (const r of R) { const k = (kinds[r.kind] ||= { n: 0, ok: 0 }); k.n++; if (!r.error && correct(r)) k.ok++; }
  const fa = ok.filter((r) => r.expect === "invalid" && r.valid), fr = ok.filter((r) => r.expect === "valid" && !r.valid);
  const lat = ok.map((r) => r.ms);
  const held = ok.filter((r) => r.kind === "held-out" && r.valid);
  let canonOk = 0;
  for (const r of held) {
    const m = r.canonical && match(indexes[r.promptId], r.canonical);
    if (m && prompts[r.promptId].answers[m.i].a === r.bank) canonOk++;
  }
  const costs = ok.map((r) => r.cost);
  const priced = costs.every((c) => c != null);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  return {
    model: run.model, tag: run.tag, n: R.length,
    errors: R.filter((r) => r.error && !r.timeout).length, timeouts: R.filter((r) => r.timeout).length,
    accuracy: R.filter((r) => !r.error && correct(r)).length / R.length, kinds, fa, fr,
    p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: lat.length ? Math.max(...lat) : null,
    inTok: mean(ok.map((r) => r.usage.input)), outTok: mean(ok.map((r) => r.usage.output)),
    per1k: priced && ok.length ? mean(costs) * 1000 : null,
    canon: held.length ? `${canonOk}/${held.length}` : "n/a",
    spearman: spearman(held.map((r) => r.rarity), held.map((r) => r.pts)),
  };
}

function report() {
  const latest = {};
  for (const r of store.runs) if (r.tag === tag) latest[r.model] = r;
  const sums = Object.values(latest).map(summarize);
  const f = (v, d = 0) => (v == null ? "n/a" : v.toFixed(d));
  let md = `# Judge benchmark (tag: ${tag})\n\nGenerated ${new Date().toISOString()}. Prices from backend/src/judge.mjs PRICES (source URL there). Total spend so far: $${spend.total.toFixed(4)} of $${CAP}.\n\n`;
  md += "| model | n | accuracy | false accepts | false rejects | p50 ms | p95 ms | max ms | errors | timeouts | in tok | out tok | $/1k | canonical ok | spearman |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const s of sums) md += `| ${s.model} | ${s.n} | ${(s.accuracy * 100).toFixed(1)}% | ${s.fa.length} | ${s.fr.length} | ${f(s.p50)} | ${f(s.p95)} | ${f(s.max)} | ${s.errors} | ${s.timeouts} | ${f(s.inTok)} | ${f(s.outTok, 1)} | ${s.per1k == null ? "n/a" : s.per1k.toFixed(3)} | ${s.canon} | ${f(s.spearman, 2)} |\n`;
  const K = ["held-out", "unlisted", "near-miss", "junk"];
  md += "\n## Accuracy by kind\n\n| model | " + K.join(" | ") + " |\n|---|---|---|---|---|\n";
  for (const s of sums) md += `| ${s.model} | ` + K.map((k) => (s.kinds[k] ? `${s.kinds[k].ok}/${s.kinds[k].n}` : "-")).join(" | ") + " |\n";
  for (const s of sums) {
    md += `\n## ${s.model}\n\nFalse accepts: ${s.fa.map((r) => `${r.promptId}:"${r.text}"`).join("; ") || "none"}\n\nFalse rejects: ${s.fr.map((r) => `${r.promptId}:"${r.text}"`).join("; ") || "none"}\n`;
  }
  const runs = Object.values(latest);
  if (runs.length > 1) {
    const wrong = {};
    for (const r of runs) for (const x of r.records) if (x.error || x.valid !== (x.expect === "valid")) (wrong[x.id] ||= []).push(r.model);
    const all = Object.entries(wrong).filter(([, m]) => m.length === runs.length);
    md += `\n## Wrong for every model\n\n${all.map(([id]) => { const c = allCases[id]; return `- ${c.promptId}: "${c.text}" (expected ${c.expect}, ${c.kind})`; }).join("\n") || "none"}\n`;
  }
  fs.writeFileSync(path.join(dir, "results.md"), md);
  return sums;
}

for (const m of (args["report-only"] ? [] : models)) {
  console.log(`running ${m} ...`);
  const run = await runModel(m);
  store.runs.push(run);
  fs.writeFileSync(resultsFile, JSON.stringify(store));
  const s = summarize(run);
  console.log(`${m}: acc ${(s.accuracy * 100).toFixed(1)}% FA ${s.fa.length} FR ${s.fr.length} p50 ${s.p50} p95 ${s.p95} err ${s.errors} to ${s.timeouts} $/1k ${s.per1k?.toFixed(3)} spend $${spend.total.toFixed(4)}`);
  if (capHit) { console.log("spend cap reached; stopping"); break; }
}
report();
