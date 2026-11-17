// Drives a real playthrough in headless Chrome over the DevTools protocol.
//
//   node tools/e2e.mjs                local mode: no API, no network
//   node tools/e2e.mjs --api          also starts backend/src/local-server.mjs and plays with ?api=local
//   node tools/e2e.mjs --shots=DIR    where screenshots go (default: a temp folder)
//
// Needs the site served at SITE (default http://localhost:5199/sloprillion/) and
// Chrome at CHROME (default: the usual Windows install path).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = process.argv.includes("--api");
const shotArg = process.argv.find((a) => a.startsWith("--shots="));
const root = new globalThis.URL("..", import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), "sloprillion-e2e-"));
const profile = join(tmp, "chrome-profile");
const shotDir = shotArg ? shotArg.slice(8) : join(tmp, "shots");
mkdirSync(shotDir, { recursive: true });
const PORT = Number(process.env.CDP_PORT) || 9347;
const SITE = process.env.SITE || "http://localhost:5199/sloprillion/";
const API_PORT = 8787; // what ?api=local means
// Local mode is forced with ?api=off, because the page itself may name a live server.
const PAGE = SITE + (API ? "?api=local" : "?api=off");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HAS_JUDGE = existsSync(new globalThis.URL("backend/src/judge.mjs", root));

let server = null;
const startServer = async () => {
  server = spawn(process.execPath, ["backend/src/local-server.mjs"], {
    cwd: root, stdio: "ignore", env: { ...process.env, PORT: String(API_PORT), ...(HAS_JUDGE ? { JUDGE_PROVIDER: "mock" } : {}) },
  });
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://localhost:${API_PORT}/v1/dist`); return; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error("local API did not start");
};
const apiGet = async (path) => (await fetch(`http://localhost:${API_PORT}${path}`)).json();
const apiPost = async (path, body) => (await fetch(`http://localhost:${API_PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
if (API) await startServer();

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--window-size=1280,900", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const logs = [];
let hold = 0;
let netCount = 0; // requests the page sent to the API (API mode only)
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        break;
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      // hold answer checks for `hold` ms so the "Checking" state can be observed
      const { requestId, request } = m.params;
      netCount++;
      const slow = hold && request.method === "POST" && /\/v1\/answer/.test(request.url);
      setTimeout(() => send("Fetch.continueRequest", { requestId }), slow ? hold : 0);
    }
    if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
}
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed: " + expr);
  return r.result.result.value;
};
const q = (sel, prop = "textContent") => ev(`(document.querySelector(${JSON.stringify(sel)}) || {})[${JSON.stringify(prop)}]`);
const screen = () => ev("document.querySelector('#app').dataset.screen");
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, "base64")); };
const type = async (text) => { await ev("document.querySelector('#answer').focus()"); await send("Input.insertText", { text }); };
const enter = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
};
const out = [];
const check = (label, ok, extra = "") => { out.push(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  [" + extra + "]" : ""}`); };

try {
  await connect();
  await send("Runtime.enable");
  await send("Page.enable");
  if (API) await send("Fetch.enable", { patterns: [{ urlPattern: `http://localhost:${API_PORT}/*` }] });
  await send("Page.navigate", { url: PAGE });
  await sleep(2500);
  await ev("localStorage.clear()");
  await send("Page.navigate", { url: PAGE });
  await sleep(2500);
  check("intro screen shows first", (await screen()) === "intro");
  check("legend has six tiers", (await ev("document.querySelectorAll('#tierLegend li').length")) === 6);
  await ev("document.querySelector('#startBtn').click()");
  await sleep(400);
  check("start goes to game", (await screen()) === "game");
  check("input is focused", await ev("document.activeElement === document.querySelector('#answer')"));
  check("round 1 prompt", /chatbot/i.test(await q(".prompt")));

  // a wrong answer bounces and keeps the round open
  await type("skynet");
  if (API) hold = 900; // keep the server's reply back so the waiting state can be seen
  await enter();
  await sleep(API ? 350 : 200);
  if (API) {
    const s1 = await q("#secs");
    check("bank miss shows the Checking state", /^Checking that answer/.test(await q("#msg")), await q("#msg"));
    check("input is disabled while checking", await ev("document.querySelector('#answer').disabled"));
    const left1 = await ev("document.querySelector('#runwayFill').style.getPropertyValue('--left')");
    await sleep(300);
    check("clock is held while checking", (await ev("document.querySelector('#runwayFill').style.getPropertyValue('--left')")) === left1, `--left ${left1}`);
    hold = 0;
    await sleep(500);
    check("clock resumed from where it paused", parseInt(await q("#secs")) <= parseInt(s1) && (await ev("document.querySelector('#runwayFill').style.getPropertyValue('--left')")) !== left1);
    check("input re-enabled and focused after rejection", await ev("!document.querySelector('#answer').disabled && document.activeElement === document.querySelector('#answer')"));
    await sleep(300);
  }
  check("wrong answer is rejected with a message", /not on today/.test(await q("#msg")), await q("#msg"));
  check("round still open after a miss", await ev("!document.querySelector('#play').hidden && document.querySelector('#after').hidden"));
  const t1 = await q("#secs");
  await sleep(1300);
  const t2 = await q("#secs");
  check("clock is counting down", parseInt(t2) < parseInt(t1), `${t1} -> ${t2}`);

  // rounds 1..6 answered by keyboard, each reveal advanced with Enter
  // in API mode round 2 is answered with "ok ..." so the mock judge has to accept it
  const answers = ["dr sbaitso", "divmod", "botha", "swish", "woz", "bogo sort"];
  // expected scores come from the round file itself, so the test follows content edits
  const { default: round } = await import(new globalThis.URL("src/rounds/001.js", root).href);
  const { buildIndex, match } = await import(new globalThis.URL("src/match.js", root).href);
  const JUDGED = API && HAS_JUDGE ? 1 : -1; // index of the round answered by the judge
  if (JUDGED >= 0) answers[JUDGED] = "ok mock answer";
  const expected = answers.map((text, r) => {
    if (r === JUDGED) return 50; // the mock judge's rarity, clamped to 20..95
    const p = round.prompts[r], hit = match(buildIndex(p), text);
    return hit ? p.answers[hit.i].pts : -1;
  });
  out.push(`      round 5 is "${round.prompts[4].q}" with ${round.prompts[4].answers.length} answers`);
  let total = 0;
  for (let r = 0; r < 6; r++) {
    if (r === 4) {
      // a known-wrong answer (a CEO who did not found the company) is refused at once, with its reason
      const net0 = netCount;
      await type("tim cook");
      await enter();
      await sleep(200);
      check("known-wrong answer shows its reason", (await q("#msg")) === `"tim cook" doesn't count. Ran the company, but did not found it.`, await q("#msg"));
      check("known-wrong answer leaves the round open", await ev("!document.querySelector('#play').hidden && document.querySelector('#after').hidden && !document.querySelector('#answer').disabled"));
      check("known-wrong answer shakes and selects the text", await ev("document.querySelector('#field').classList.contains('nope') && (() => { const i = document.querySelector('#answer'); return i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value.length > 0; })()"));
      if (API) check("known-wrong answer makes no server call", netCount === net0, `${netCount - net0} requests`);
    }
    await ev("document.querySelector('#answer').value = ''");
    await type(answers[r]);
    await enter();
    await sleep(160);
    if (r === 0) {
      const mid = parseInt(String(await q(".verdict-pts")).replace("+", ""));
      check("score counts up instead of appearing at once", mid > 0 && mid < 100, `showing +${mid} (${await q(".verdict-tier")}) 160ms after Enter`);
      check("rest of the result is held back while counting", await ev("document.querySelector('#after').classList.contains('pending') && getComputedStyle(document.querySelector('#nextBtn')).visibility === 'hidden'"));
      await shot("e2e-counting");
    }
    await sleep(1600);
    const pts = parseInt(String(await q(".verdict-pts")).replace("+", ""));
    total += pts;
    check(`round ${r + 1} "${answers[r]}" scores ${expected[r]}`, pts === expected[r], `${await q(".verdict-tier")} / ${await q(".verdict-ans")}`);
    if (r === 0) {
      await sleep(1300);
      await shot("e2e-reveal-10x");
      check("valuation sign after a 10x", (await q("#hudVal")) === "$1.00M", await q("#hudVal"));
    }
    check(`round ${r + 1} next button holds focus`, await ev("!!document.activeElement && document.activeElement.id === 'nextBtn'"));
    await enter();
    await sleep(350);
    check(`advanced to round ${r + 2}`, (await q("#hudCount")) === `Round ${r + 2} of 7`, await q("#hudStage"));
  }

  // round 7: a wrong answer, then let the clock run out
  await ev("document.querySelector('#answer').value = ''");
  await type("elon musk"); // not a winner, and not on the known-wrong list either
  await enter();
  await sleep(API ? 500 : 200);
  check("non-winner rejected in round 7", /not on today/.test(await q("#msg")));
  const left = parseInt(await q("#secs"));
  await sleep(left * 1000 + 900);
  check("timeout settles the round at +0", (await q(".verdict-pts")) === "+0", await q(".verdict-tier"));
  await shot("e2e-timeout");
  await ev("document.querySelector('#nextBtn').click()");
  await sleep(500);
  check("final screen", (await screen()) === "final");
  check("final points match", (await q("#finalPts")) === `${total} of 700 points`, await q("#finalPts"));
  out.push(`      final: ${await q("#finalVal")} ${await q("#finalClass")}`);
  check("seven recap rows", (await ev("document.querySelectorAll('#recap li').length")) === 7);
  if (API) {
    await sleep(500);
    check("real tally of one player keeps the estimate wording", /^Ahead of .* of today's players$/.test(await q(".dist-title")) && /estimate/.test(await q(".dist-note")), await q(".dist-title"));
  }
  check("distribution curve is drawn", await ev("!!document.querySelector('.dist-plot svg .dist-line') && /Ahead of/.test(document.querySelector('.dist-title').textContent)"), await q(".dist-title"));
  const box = await ev("(() => { const r = document.querySelector('.dist-plot').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.6 }; })()");
  await ev("document.querySelector('.dist-plot').scrollIntoView({ block: 'center' })");
  const box2 = await ev("(() => { const r = document.querySelector('.dist-plot').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.6 }; })()");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box2.x, y: box2.y });
  await sleep(150);
  check("hovering the curve reads out a point", await ev("!document.querySelector('.dist-tip').hidden"), String(await q(".dist-tip")).replace(/(\d)(ahead)/, "$1, $2"));
  await shot("e2e-dist-hover");
  void box;
  await sleep(600);
  await shot("e2e-final");
  await send("Page.navigate", { url: PAGE });
  await sleep(2000);
  check("result survives a reload", (await screen()) === "final" && (await q("#finalPts")) === `${total} of 700 points`);
  const netBeforeReplay = netCount;
  await ev("document.querySelector('#againBtn').click()");
  await sleep(400);
  check("play again restarts at round 1 with a clean score", (await q("#hudCount")) === "Round 1 of 7" && (await q("#hudVal")) === "$100K");
  if (API) {
    // what the server saw: the first finish is the one that counts, so asking again is safe
    const session = await ev("localStorage.getItem('sloprillion:session')");
    check("session id is 22 URL-safe characters", /^[A-Za-z0-9_-]{22}$/.test(session || ""), session);
    const fin = await apiPost("/v1/finish", { date: round.date, session });
    check("server score equals the on-screen points", fin.score === total, `server ${fin.score}, page ${total}`);
    const jr = fin.results[JUDGED] || {};
    if (JUDGED >= 0) check("judge-accepted answer was recorded", jr.pts === 50 && jr.a === "ok mock answer", JSON.stringify(jr));
    const dist = await apiGet(`/v1/dist?date=${round.date}`);
    check("GET /v1/dist shows one player", dist.players === 1 && dist.counts.length === 71 && dist.counts.reduce((a, b) => a + b, 0) === 1, `players ${dist.players}`);
  }

  // the replay is a practice run: first bank answer of every prompt, entirely local
  const { default: round2 } = await import(new globalThis.URL("src/rounds/002.js", root).href);
  for (let r = 0; r < 7; r++) {
    await ev("document.querySelector('#answer').value = ''");
    await type(round.prompts[r].answers[0].a);
    await enter();
    await sleep(1700);
    await ev("document.querySelector('#nextBtn').click()");
    await sleep(350);
  }
  check("practice run reaches the final screen", (await screen()) === "final");
  check("practice run's note says so", /practice run/.test(await q(".dist-note")), await q(".dist-note"));
  check("practice run draws the estimated curve", await ev("!!document.querySelector('.dist-plot svg .dist-line') && /estimate/.test(document.querySelector('.dist-note').textContent)"));
  if (API) {
    await sleep(500);
    check("replay made no network calls", netCount === netBeforeReplay, `${netCount - netBeforeReplay} requests`);
    const after = await apiGet(`/v1/dist?date=${round.date}`);
    check("replay did not reach the day's tally", after.players === 1, `players ${after.players}`);
  }
  const practiceTotal = await q("#finalPts");
  await send("Page.navigate", { url: PAGE });
  await sleep(2000);
  check("replay leaves the first result saved", (await screen()) === "final" && (await q("#finalPts")) === `${total} of 700 points` && practiceTotal !== `${total} of 700 points`, `${await q("#finalPts")} (practice was ${practiceTotal})`);
  check("first result's note has no practice wording", !/practice/.test(await q(".dist-note")));
  await ev("localStorage.clear()");

  // ?day=2 loads the second round, and its first prompt answers from the bank
  await send("Page.navigate", { url: PAGE + "&day=2" });
  await sleep(2000);
  await ev("localStorage.clear()");
  await send("Page.navigate", { url: PAGE + "&day=2" });
  await sleep(2000);
  check("?day=2 intro names round 2", /round 2/i.test(await q("#startBtn")), await q("#startBtn"));
  await ev("document.querySelector('#startBtn').click()");
  await sleep(400);
  const p2 = round2.prompts[0];
  check("?day=2 first prompt is round two's", (await q(".prompt")) === p2.q, await q(".prompt"));
  await type(p2.answers[1].a);
  await enter();
  await sleep(1700);
  check("?day=2 first prompt answers from the bank", (await q(".verdict-pts")) === `+${p2.answers[1].pts}` && (await q(".verdict-ans")) === p2.answers[1].a, `${await q(".verdict-ans")} ${await q(".verdict-pts")}`);
  await ev("localStorage.clear()");

  if (API) {
    // the server dies mid-game: the game must still play through locally
    await send("Page.navigate", { url: PAGE });
    await sleep(2000);
    await ev("localStorage.clear()");
    await send("Page.navigate", { url: PAGE });
    await sleep(2000);
    await ev("document.querySelector('#startBtn').click()");
    await sleep(400);
    await type("chatgpt");
    await enter();
    await sleep(1800);
    await ev("document.querySelector('#nextBtn').click()");
    await sleep(400);
    server.kill();
    await sleep(500);
    const offline = ["divmod", "botha", "swish", "woz", "bogo sort"];
    check("round 2 after the server died", (await q("#hudCount")) === "Round 2 of 7");
    await type("skynet");
    await enter();
    await sleep(500);
    check("offline bank miss is rejected locally", /not on today/.test(await q("#msg")) && await ev("!document.querySelector('#answer').disabled"), await q("#msg"));
    for (let r = 0; r < offline.length; r++) {
      await ev("document.querySelector('#answer').value = ''");
      await type(offline[r]);
      await enter();
      await sleep(1800);
      await ev("document.querySelector('#nextBtn').click()");
      await sleep(350);
    }
    check("offline game reached round 7", (await q("#hudCount")) === "Round 7 of 7");
    await sleep(25500);
    await ev("document.querySelector('#nextBtn').click()");
    await sleep(500);
    check("offline game reaches the final screen", (await screen()) === "final");
    await sleep(800);
    check("offline final draws the estimated curve", await ev("!!document.querySelector('.dist-plot svg .dist-line') && /estimate/.test(document.querySelector('.dist-note').textContent)"), await q(".dist-title"));
    await ev("localStorage.clear()");
  }
} catch (e) {
  out.push("ERROR " + (e.stack || e));
}
console.log(out.join("\n"));
const real = logs.filter((l) => !/\[vite\]|React DevTools/i.test(l));
console.log("\nconsole and exception log:\n" + (real.join("\n") || "  (clean)"));
const passed = out.filter((l) => l.startsWith("PASS")).length, failed = out.filter((l) => l.startsWith("FAIL") || l.startsWith("ERROR")).length;
console.log(`
${API ? "api" : "local"} mode: ${passed} passed, ${failed} failed. screenshots in ${shotDir}`);
// kill the whole Chrome process tree, or a helper keeps the debugging port busy for the next run
if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"]); else chrome.kill();
if (server) server.kill();
process.exit(failed ? 1 : 0);
