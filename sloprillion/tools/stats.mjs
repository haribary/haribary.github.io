// Prints visitors and finished games per day, by source, from the live API.
// The same numbers as the page at /sloprillion/stats.html.
//
//   node tools/stats.mjs            the last 14 days
//   node tools/stats.mjs 30         the last 30 days (60 at most)
//
// The key is read from SLOPRILLION_STATS_KEY, in the environment or in the
// .env file at the top of the repo. API=<url> points it at another server
// (API=http://localhost:8787 with key "dev" for the local one).

import { readFileSync } from "node:fs";

const read = (rel) => { try { return readFileSync(new URL(rel, import.meta.url), "utf8"); } catch { return ""; } };
const api = (process.env.API || read("../index.html").match(/<meta name="sloprillion-api" content="([^"]+)"/)?.[1] || "").replace(/\/+$/, "");
const key = process.env.SLOPRILLION_STATS_KEY
  || read("../../.env").match(/^SLOPRILLION_STATS_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "")
  || (/localhost|127\.0\.0\.1/.test(api) ? "dev" : "");
if (!api) { console.error("No API address: set API=<url> or name one in index.html."); process.exit(2); }
if (!key) { console.error("No key: set SLOPRILLION_STATS_KEY in the environment or in the repo's .env file."); process.exit(2); }

const { calendar, daysLeft } = await import("../src/rounds/index.js");
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const days = Math.min(60, Math.max(1, Number(process.argv[2]) || 14));

const res = await fetch(`${api}/v1/stats?key=${encodeURIComponent(key)}&to=${today}&days=${days}`);
if (res.status === 404) { console.error("The API did not accept the key (or stats are switched off there)."); process.exit(1); }
if (!res.ok) { console.error(`The API answered ${res.status}.`); process.exit(1); }
const data = await res.json();

const width = Math.max(12, ...data.days.flatMap((d) => d.sources.map((s) => s.src.length + 2)));
const line = (name, site, game, finished) => `${name.padEnd(width)}  ${String(site).padStart(6)}  ${String(game).padStart(6)}  ${String(finished).padStart(8)}`;
console.log(line("", "site", "game", "finished"));
for (const d of [...data.days].reverse()) {
  if (!(d.site + d.game + d.finished)) continue;
  console.log(line(`${d.date} #${d.round}`, d.site, d.game, d.finished));
  for (const s of d.sources) console.log(line("  " + s.src, s.site, s.game, s.finished));
}
const quiet = data.days.filter((d) => !(d.site + d.game + d.finished)).length;
if (quiet) console.log(`(${quiet} of ${data.days.length} days had nothing recorded)`);
const left = daysLeft(calendar, today);
console.log(left > 0
  ? `\nNew rounds are written up to ${calendar.at(-1).date}: ${left} more day(s) after today. After that old rounds repeat.`
  : "\nThe written rounds have run out: the game is repeating old ones, one a day.");
