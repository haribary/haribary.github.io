// Assemble backend/dist/ for Lambda: backend/src/*.mjs plus the shared game
// code from ../src, with import paths rewritten so nothing reaches outside dist.
//   ../../src/X  ->  ./X      (match.js, config.js, rounds/*.js)
// Run: node scripts/build.mjs   (then python scripts/package.py to zip)

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");
const shared = join(backend, "..", "src");
const dist = join(backend, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "rounds"), { recursive: true });

// Backend modules. local-server and the tests are dev only.
for (const f of readdirSync(join(backend, "src"))) {
  if (!f.endsWith(".mjs") || f === "local-server.mjs") continue;
  const code = readFileSync(join(backend, "src", f), "utf8").replaceAll("../../src/", "./");
  writeFileSync(join(dist, f), code);
}

// Shared game code, only what the server uses.
for (const f of ["match.js", "config.js"]) cpSync(join(shared, f), join(dist, f));
// index.js lists the rounds and imports each one, so the round files go with it.
// Subfolders (authoring leftovers) stay behind.
for (const f of readdirSync(join(shared, "rounds"), { withFileTypes: true })) {
  if (f.isFile() && f.name.endsWith(".js")) cpSync(join(shared, "rounds", f.name), join(dist, "rounds", f.name));
}

// The shared files are ES modules with a .js extension.
writeFileSync(join(dist, "package.json"), JSON.stringify({ type: "module" }) + "\n");

// Guard: nothing in dist may import outside dist.
for (const f of readdirSync(dist)) {
  if (!/\.m?js$/.test(f)) continue;
  const code = readFileSync(join(dist, f), "utf8");
  if (/\.\.\/(\.\.\/)?src\//.test(code)) throw new Error(`${f} still reaches into ../src`);
}

console.log("dist ready:", readdirSync(dist).join(", "), existsSync(join(dist, "judge.mjs")) ? "" : "(no judge.mjs yet)");
