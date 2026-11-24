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
// A port of its own for each run, so a browser left over from an earlier run cannot be in the way.
const PORT = Number(process.env.CDP_PORT) || 9300 + Math.floor(Math.random() * 600);
const SITE = process.env.SITE || "http://localhost:5199/sloprillion/";
const API_PORT = 8787; // what ?api=local means
// Local mode is forced with ?api=off, because the page itself may name a live server.
// The playthrough is written against round 1, whatever today's round is.
const PAGE = SITE + (API ? "?api=local" : "?api=off") + "&day=1";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HAS_JUDGE = existsSync(new globalThis.URL("backend/src/judge.mjs", root));

let server = null;
const startServer = async () => {
  server = spawn(process.execPath, ["backend/src/local-server.mjs"], {
    cwd: root, stdio: "ignore", env: { ...process.env, PORT: String(API_PORT), STATS_KEY: "e2e", PAST_DAYS: "36500", ...(HAS_JUDGE ? { JUDGE_PROVIDER: "mock" } : {}) },
  });
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://localhost:${API_PORT}/v1/dist`); return; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error("local API did not start");
};
const apiGet = async (path) => (await fetch(`http://localhost:${API_PORT}${path}`)).json();
const PLAYER = "Test Founder"; // the name the first playthrough goes on the board under
// A name the server's word list refuses, kept in ROT13 as the list itself is.
const BLOCKED_NAME = "shpx".replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
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
  // Chrome opens the port on one loopback address or the other, so try both.
  let open = null;
  for (let i = 0; i < 40 && !open; i++) {
    for (const host of ["127.0.0.1", "[::1]"]) {
      try {
        const list = await (await fetch(`http://${host}:${PORT}/json`)).json();
        const page = list.find((t) => t.type === "page");
        if (!page) continue;
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
        open = socket;
        break;
      } catch { /* not up yet */ }
    }
    if (!open) await sleep(250);
  }
  if (!open) throw new Error(`could not reach Chrome's debugging port ${PORT}`);
  ws = open;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      // hold answer checks for `hold` ms so the "Checking" state can be observed
      const { requestId, request } = m.params;
      // reading the leaderboard changes nothing on the server, so it is not counted
      if (!(request.method === "GET" && /\/v1\/board/.test(request.url))) netCount++;
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
  if (API) {
    check("nickname field is offered, with no label line above it", await ev("!document.querySelector('#nameBar').hidden && document.querySelector('#playerName').value === '' && document.querySelector('#playerName').placeholder === 'Nickname' && !/leaderboard|optional/i.test(document.querySelector('#nameBar').innerText)"));
    // the test window is wide, so the board is the roadside billboard: left of the column, risen above it, ten places
    const lay = await ev("(() => { const b = document.querySelector('#introBoard .board-face').getBoundingClientRect(), c = document.querySelector('#startBtn').getBoundingClientRect(), d = document.querySelector('.deck').getBoundingClientRect(); return { wide: innerWidth >= 1240, right: b.right, colLeft: c.left, left: b.left, top: b.top, deckTop: d.top, width: b.width, places: document.querySelectorAll('#introBoard .lb-rows li').length, shown: [...document.querySelectorAll('#introBoard .lb-rows li.open')].filter((li) => li.offsetHeight > 0).length }; })()");
    check("wide screen: the board stands in the left margin, rising above the column, with ten open places", lay.wide && lay.right < lay.colLeft && lay.left > 0 && lay.top < lay.deckTop - 100 && lay.width >= 260 && lay.places === 10 && lay.shown === 10, JSON.stringify(lay));
    const emptyBoard = await ev("document.querySelector('#introBoard .lb-face').innerText.split(/[^A-Za-z0-9']+/).filter(Boolean).join(' ')");
    check("intro board is shown with nothing on it but its title and ten numbered places", await ev("!document.querySelector('#introBoard').hidden && document.querySelectorAll('#introBoard .lb-rows li:not(.open)').length === 0") && /^top 10 1 2 3 4 5 6 7 8 9 10$/i.test(emptyBoard), emptyBoard);
    await ev("document.querySelector('#playerName').value = '<b>bold</b>'");
    await ev("document.querySelector('#startBtn').click()");
    await sleep(300);
    check("a name with odd characters is caught before the round starts", (await screen()) === "intro" && /Use letters, numbers/.test(await q("#nameMsg")), await q("#nameMsg"));
    await ev(`document.querySelector('#playerName').value = '  ${PLAYER}  '`);
  } else {
    check("no server: no name field and no board", await ev("document.querySelector('#nameBar').hidden && document.querySelector('#introBoard').hidden"));
  }
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
    check("real tally of one player keeps the title without a player count", /^Ahead of .* of today's players$/.test(await q(".dist-title")), await q(".dist-title"));
    check("first result shows no note under the curve", await ev("document.querySelector('.dist-note').hidden && document.querySelector('.dist-note').textContent === ''"));
    const mine = await ev("(() => { const rows = [...document.querySelectorAll('#finalBoard .lb-rows li:not(.open)')]; const me = rows.filter((li) => li.classList.contains('me')); return { rows: rows.length, me: me.length, rank: me[0]?.querySelector('.lb-rank').textContent, name: me[0]?.querySelector('.lb-name').firstChild.textContent, tag: me[0]?.querySelector('.lb-you')?.textContent, val: me[0]?.querySelector('.lb-val').textContent }; })()");
    check("the board lists the player first, under the tidied name, at the valuation on the billboard", mine.rows === 1 && mine.me === 1 && mine.rank === "1" && mine.name === PLAYER && mine.tag === "You" && mine.val === (await q("#finalVal")), JSON.stringify(mine));
    check("a named result gets no name form", await ev("document.querySelector('#addName').hidden"));
    check("the name is remembered for tomorrow", (await ev("localStorage.getItem('sloprillion:name')")) === PLAYER);
  } else {
    check("no server: no board on the results screen", await ev("document.querySelector('#finalBoard').hidden && document.querySelector('#addName').hidden"));
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
    // The page is on localhost, so its visits count as "dev". Two of them: this run wiped storage after
    // its first load, which makes the browser new again; the reload after the game did not count again.
    const seen = (await apiGet(`/v1/stats?key=e2e&to=${round.date}&days=1`)).days?.[0] || {};
    check("visits and the finished game are counted under their source",
      seen.game === 2 && seen.finished === 1 && JSON.stringify(seen.sources) === JSON.stringify([{ src: "dev", site: 0, game: 2, finished: 1 }]), JSON.stringify(seen));
    check("stats are refused without the key", (await fetch(`http://localhost:${API_PORT}/v1/stats?key=nope`)).status === 404);
    // the owner's view of the day: one game, the name it went on the board under, and what the judge let in
    const day = await apiGet(`/v1/day?key=e2e&date=${round.date}`);
    const given = (day.prompts || []).reduce((sum, p) => sum + p.given, 0), valid = fin.results.filter((x) => x.a).length;
    check("the owner's day shows the finished game", day.round === round.id && day.players === 1 && day.prompts.length === 7 && given === valid, `players ${day.players}, given ${given}, valid ${valid}`);
    // The judge's calls are counted against the real (UTC) day, whatever day was played.
    const used = (await apiGet("/v1/day?key=e2e")).judge?.used;
    if (JUDGED >= 0) check("and the answer the judge let in", day.prompts[JUDGED].accepted.some((x) => x.a === "ok mock answer" && x.bank === false) && used >= 1, `${JSON.stringify(day.prompts[JUDGED].accepted)}, judge calls today ${used}`);
    check("the owner's day is refused without the key", (await fetch(`http://localhost:${API_PORT}/v1/day?key=nope`)).status === 404);
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
  check("practice run draws the curve", await ev("!!document.querySelector('.dist-plot svg .dist-line')"));
  check("practice note is only the practice sentence", (await q(".dist-note")) === "This was a practice run, so it is not counted.", await q(".dist-note"));
  if (API) {
    await sleep(500);
    check("replay sent nothing to the server but a read of the board", netCount === netBeforeReplay, `${netCount - netBeforeReplay} requests`);
    check("practice final shows the board with the first result's row, and no name form", (await ev("document.querySelectorAll('#finalBoard .lb-rows li.me').length")) === 1 && await ev("document.querySelector('#addName').hidden"));
    const after = await apiGet(`/v1/dist?date=${round.date}`);
    check("replay did not reach the day's tally", after.players === 1, `players ${after.players}`);
  }
  const practiceTotal = await q("#finalPts");
  await send("Page.navigate", { url: PAGE });
  await sleep(2000);
  check("replay leaves the first result saved", (await screen()) === "final" && (await q("#finalPts")) === `${total} of 700 points` && practiceTotal !== `${total} of 700 points`, `${await q("#finalPts")} (practice was ${practiceTotal})`);
  check("first result's note has no practice wording", !/practice/.test(await q(".dist-note")));
  if (API) check("a reload still shows the player's row on the board", (await ev("document.querySelectorAll('#finalBoard .lb-rows li.me').length")) === 1);
  await ev("localStorage.clear()");

  if (API) {
    // a second player skips the name, then adds one from the results screen
    await send("Page.navigate", { url: PAGE });
    await sleep(2000);
    check("the next visitor sees the first player on the intro board", (await ev("document.querySelectorAll('#introBoard .lb-rows li:not(.open)').length")) === 1 && (await ev("document.querySelectorAll('#introBoard .lb-rows li.me').length")) === 0 && (await q("#introBoard .lb-name")) === PLAYER, await q("#introBoard .lb-name"));
    await shot("e2e-intro-board");
    await ev("document.querySelector('#startBtn').click()");
    await sleep(400);
    for (let r = 0; r < 7; r++) {
      await ev("document.querySelector('#answer').value = ''");
      await type(round.prompts[r].answers[0].a);
      await enter();
      await sleep(1700);
      await ev("document.querySelector('#nextBtn').click()");
      await sleep(350);
    }
    await sleep(900);
    check("an unnamed result is not on the board and is offered the name form", (await screen()) === "final" && (await ev("document.querySelectorAll('#finalBoard .lb-rows li.me').length")) === 0 && await ev("!document.querySelector('#addName').hidden"));
    const addName = async (text) => {
      await ev(`document.querySelector('#addNameInput').value = ${JSON.stringify(text)}`);
      await ev("document.querySelector('#addNameBtn').click()");
      await sleep(700);
    };
    await addName("");
    check("an empty name is asked for", /Type a name first/.test(await q("#addNameMsg")), await q("#addNameMsg"));
    await addName(BLOCKED_NAME);
    check("a name the server refuses stays off the board, with the reason", /can't go on the board/.test(await q("#addNameMsg")) && (await ev("document.querySelectorAll('#finalBoard .lb-rows li:not(.open)').length")) === 1 && await ev("!document.querySelector('#addName').hidden"), await q("#addNameMsg"));
    await addName("Late Joiner");
    const two = await ev("[...document.querySelectorAll('#finalBoard .lb-rows li:not(.open)')].map((li) => [li.querySelector('.lb-rank').textContent, li.querySelector('.lb-name').firstChild.textContent, li.classList.contains('me')])");
    check("adding a name afterwards puts the result on the board, ranked by score", two.length === 2 && two.filter((r) => r[2]).length === 1 && two.find((r) => r[2])[1] === "Late Joiner" && await ev("document.querySelector('#addName').hidden"), JSON.stringify(two));
    await ev("document.querySelector('#finalBoard').scrollIntoView({ block: 'center' })");
    await sleep(200);
    await shot("e2e-final-board");
    const tally = await apiGet(`/v1/dist?date=${round.date}`);
    check("adding a name did not count the player twice", tally.players === 2, `players ${tally.players}`);
    await ev("localStorage.clear()");
  }

  // ?day=2 loads the second round, and its first prompt answers from the bank
  await send("Page.navigate", { url: PAGE.replace("day=1", "day=2") });
  await sleep(2000);
  await ev("localStorage.clear()");
  await send("Page.navigate", { url: PAGE.replace("day=1", "day=2") });
  await sleep(2000);
  check("the start button carries no round number", (await q("#startBtn")) === "Start round", await q("#startBtn"));
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
    check("offline final draws the curve", await ev("!!document.querySelector('.dist-plot svg .dist-line')"), await q(".dist-title"));
    const down = await ev("(() => { const b = document.querySelector('#finalBoard'); return { hidden: b.hidden, open: [...b.querySelectorAll('.lb-rows li.open')].filter((li) => li.offsetHeight > 0).length, rows: b.querySelectorAll('.lb-rows li').length, text: b.querySelector('.lb-face').innerText.split(/[^A-Za-z0-9']+/).filter(Boolean).join(' ') }; })()");
    check("a board that cannot be loaded shows ten blank places and no message", !down.hidden && down.open === 10 && down.rows === 10 && /^top 10 1 2 3 4 5 6 7 8 9 10$/i.test(down.text), JSON.stringify(down));
    await ev("localStorage.clear()");
  }

  // The calendar, seen with the browser's clock moved: a day inside the run of written rounds, the days
  // after the last one (the rounds come round again), and a result saved
  // under the old per-round key being carried over to the per-day one.
  if (!API) {
    const { calendar } = await import(new globalThis.URL("src/rounds/index.js", root).href);
    const roundFile = async (id) => (await import(new globalThis.URL(`src/rounds/${String(id).padStart(3, "0")}.js`, root).href)).default;
    const plusDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
    const last = calendar[calendar.length - 1], count = calendar.length;
    // Loads the game with the clock set to noon on `date`; `before` runs first, for seeding storage.
    const openOn = async (date, before = "") => {
      const source = `(() => { const Real = Date, shift = new Real(${JSON.stringify(date + "T12:00:00")}).getTime() - Real.now();
        class Moved extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
        window.Date = Moved; ${before} })();`;
      const added = await send("Page.addScriptToEvaluateOnNewDocument", { source });
      await send("Page.navigate", { url: SITE + "?api=off" });
      await sleep(1500);
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.result.identifier });
    };
    const firstPrompt = async () => { await ev("document.querySelector('#startBtn').click()"); await sleep(500); return q(".prompt"); };

    const third = calendar[2], r3 = await roundFile(third.id);
    await openOn(third.date);
    check("on a round's own day the page plays that round's prompts", (await firstPrompt()) === r3.prompts[0].q, await q(".prompt"));

    const r1 = await roundFile(calendar[0].id);
    await openOn(plusDays(last.date, 1));
    check("the day after the last round, round 1 comes round again", (await firstPrompt()) === r1.prompts[0].q, await q(".prompt"));
    const r2 = await roundFile(calendar[1].id);
    await openOn(plusDays(last.date, count + 2));
    check("a full cycle later the rounds are still turning", (await firstPrompt()) === r2.prompts[0].q, await q(".prompt"));

    const old = JSON.stringify({ score: 70, results: r3.prompts.map((p) => ({ id: p.id, a: p.answers[0].a, pts: 10, tier: 1 })) });
    await openOn(third.date, `localStorage.clear(); localStorage.setItem("sloprillion:round:${third.id}", ${JSON.stringify(old)}); localStorage.setItem("sloprillion:day:2020-01-01", "{}");`);
    const keys = await ev("Object.keys(localStorage).filter((k) => /^sloprillion:(day|round):/.test(k)).sort().join(' ')");
    check("a result saved under the old per-round key is carried over, and stale days are dropped",
      (await screen()) === "final" && keys === `sloprillion:day:${third.date}`, `${await screen()} / ${keys}`);
    // The same round a cycle later is a new day: nothing saved, so it can be played again.
    await openOn(plusDays(last.date, third.id), "");
    check("the same round on a later day starts fresh", (await screen()) === "intro", await screen());
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
