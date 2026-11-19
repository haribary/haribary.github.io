// Screens and game flow. Rules live in config.js, answer checking in match.js,
// the street in scene.js.

import { calendar, pickByDate, dayNumber, forcedEntry, loadRound } from "./rounds/index.js";
import {
  ROUND_SECONDS, STAGES, TIERS, BAND_FLEX,
  tierIndex, scalePosition, valuation, multiple, money, companyClass,
} from "./config.js";
import { buildIndex, match, matchWrong } from "./match.js";
import { createScene } from "./scene.js";
import { drawWordmark, tierIcon } from "./sprites.js";
import { estimateDay, fromServer, renderDistribution } from "./dist.js";
import { renderBoard } from "./board.js";
import { tidyName, nameProblem } from "./name.js";
import { createApi } from "./api.js";
import { localDate, firstVisit, automated } from "./visits.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const app = $("#app");
const face = $("#face"), play = $("#play"), after = $("#after");
const input = $("#answer"), field = $("#field"), msg = $("#msg");
const runway = $("#runway"), runwayFill = $("#runwayFill"), secs = $("#secs");
const pop = $("#pop");

const query = new URLSearchParams(location.search);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const frozen = query.has("freeze"); // dev: hold the clock for screenshots

// Today's round by the player's own calendar. Once the written rounds run out
// they come round again, a day at a time, each day with its own board and its
// own saved result. ?day=<round id> forces a round and plays it under that
// round's own date, for testing and previews.
const today = localDate();
const forced = forcedEntry(query.get("day"));
const entry = forced || pickByDate(calendar, today);
const playDate = forced ? forced.date : today; // the day this game counts for
const dayNo = forced ? forced.id : dayNumber(calendar, today); // "Sloprillion #12"
const round = await loadRound(entry);
const serverApi = createApi(playDate, query); // null in local mode: no network calls at all

// Where this player came from (see visits.js): settled on the first visit of
// the day, counted once, and sent again with the finished game.
const source = firstVisit("game", playDate, location.pathname);
if (serverApi && source.first && !automated()) serverApi.visit(source.src);
// Only the first game of the day reaches the server: the server locks each
// prompt per session for the day, so a replay is a practice run played locally.
let practice = false;
const net = () => (practice ? null : serverApi);

const prompts = round.prompts.map((p) => ({ ...p, index: buildIndex(p) }));
const N = prompts.length;
// The finished game is kept per day. Older saves sat under the round's id:
// carry that one over if it is for today, and drop saves from past days.
const SAVE_PREFIX = "sloprillion:day:";
const SAVE_KEY = SAVE_PREFIX + playDate;
try {
  const legacy = `sloprillion:round:${round.id}`, old = localStorage.getItem(legacy);
  if (old && playDate === entry.date) {
    if (!localStorage.getItem(SAVE_KEY)) localStorage.setItem(SAVE_KEY, old);
    localStorage.removeItem(legacy);
  }
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(SAVE_PREFIX) && key !== SAVE_KEY && key.slice(SAVE_PREFIX.length) < today) localStorage.removeItem(key);
  }
} catch { /* storage blocked: nothing to carry over */ }

const scene = createScene($("#scene"), { reduced });
drawWordmark($("#wordmark"));

const state = { i: 0, score: 0, results: [], phase: "intro", deadline: 0, raf: 0, shown: 0 };
let estimate = null; // the day's estimated score distribution, built the first time it is shown

// ------------------------------------------------------------------ helpers
function setScreen(name) {
  app.dataset.screen = name;
  window.scrollTo(0, 0);
  scene.resize();
}

// A preview of a round whose day has not come (?day=) is not kept: the save
// would stand in for the real game when that day arrives.
const keep = !(forced && forced.date > today);
const store = {
  get() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } },
  set(v) { if (keep) try { localStorage.setItem(SAVE_KEY, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } },
};

// The name the player goes on the leaderboard under. It is optional, asked for
// before the first round and remembered for tomorrow. The server has the last
// word on it; these lines explain a refusal.
const NAME_KEY = "sloprillion:name";
const NAME_HELP = {
  empty: "Type a name first.",
  long: "Names can be up to 16 characters.",
  invalid: "Use letters, numbers, spaces, dots, dashes, underscores or apostrophes.",
  blocked: "That name can't go on the board. Try another.",
};
const keptName = {
  get() { try { return tidyName(localStorage.getItem(NAME_KEY)); } catch { return ""; } },
  set(v) { try { if (v) localStorage.setItem(NAME_KEY, v); else localStorage.removeItem(NAME_KEY); } catch { /* play on */ } },
};
let runName = ""; // the name this game's result is posted under; empty stays off the board

function say(el, text) {
  el.textContent = text || "";
  el.hidden = !text;
}

function renderPips() {
  $("#pips").innerHTML = prompts.map((_, k) => {
    const r = state.results[k];
    if (r) return `<i style="background:${TIERS[r.tier].color}"></i>`;
    return `<i class="${k === state.i ? "cur" : ""}"></i>`;
  }).join("");
}

// Count the valuation sign up from one score to another.
function rollValuation(from, to) {
  const el = $("#hudVal");
  if (reduced || from === to) { el.textContent = money(valuation(to)); state.shown = to; return; }
  const t0 = performance.now(), dur = 900;
  const step = (now) => {
    const u = Math.min(1, (now - t0) / dur);
    const s = from + (to - from) * (1 - Math.pow(1 - u, 3));
    el.textContent = money(valuation(s));
    if (u < 1) requestAnimationFrame(step); else state.shown = to;
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------- intro
function showIntro() {
  state.phase = "intro";
  setScreen("intro");
  scene.goTo(0, true);
  $("#startBtn").textContent = `Start round ${dayNo}`;
  // The board and the name on it need the server; without one neither is shown.
  if (serverApi) {
    $("#nameBar").hidden = false;
    $("#playerName").value = keptName.get();
    const root = $("#introBoard");
    renderBoard(root, null); // ten empty places until the answer comes
    serverApi.board().then((board) => renderBoard(root, board));
  }
}

// Start button, or Enter in the name field. A name that cannot be used is
// caught here, before any time is spent on the round.
function begin(e) {
  e.preventDefault();
  if (serverApi) {
    const field = $("#playerName"), name = tidyName(field.value);
    const problem = name ? nameProblem(name) : null;
    say($("#nameMsg"), problem && NAME_HELP[problem]);
    if (problem) { field.focus(); return; }
    keptName.set(name);
    runName = name;
  }
  startGame();
}

function renderLegend() {
  const list = $("#tierLegend");
  TIERS.slice(1).forEach((t) => {
    const li = document.createElement("li");
    li.style.setProperty("--tier", t.color);
    li.append(tierIcon(t.key));
    li.insertAdjacentHTML("beforeend", `<b>${esc(t.name)}</b><span>${esc(t.range)} points</span>`);
    list.append(li);
  });
}

// -------------------------------------------------------------------- game
function startGame() {
  state.i = 0; state.score = 0; state.results = []; state.shown = 0;
  setScreen("game");
  $("#hudVal").textContent = money(valuation(0));
  startRound(0);
}

function startRound(i, instant = false) {
  const p = prompts[i];
  state.i = i;
  state.phase = "answering";
  state.misses = 0;
  scene.goTo(i, instant);
  $("#hudCount").textContent = `Round ${i + 1} of ${N}`;
  $("#hudStage").textContent = STAGES[i];
  renderPips();

  face.style.removeProperty("--tier");
  face.innerHTML =
    `<p class="cat">${esc(p.category)}</p><p class="ask">Name</p><h2 class="prompt">${esc(p.q)}</h2>` +
    (p.note ? `<p class="note">${esc(p.note)}</p>` : "");
  after.hidden = true;
  play.hidden = false;
  msg.textContent = "";
  field.classList.remove("nope");
  input.disabled = false;
  input.value = "";
  input.focus({ preventScroll: true });

  state.deadline = performance.now() + ROUND_SECONDS * 1000;
  cancelAnimationFrame(state.raf);
  tick();
}

function tick() {
  const total = ROUND_SECONDS * 1000;
  const left = frozen ? total * 0.68 : Math.max(0, state.deadline - performance.now());
  runwayFill.style.setProperty("--left", (left / total).toFixed(4));
  secs.textContent = Math.ceil(left / 1000) + "s";
  runway.classList.toggle("low", left <= 5000);
  if (left <= 0) {
    const api = net();
    if (api) api.timedOut(prompts[state.i].id);
    return settle(null);
  }
  if (!frozen) state.raf = requestAnimationFrame(tick);
}

async function submit(e) {
  e.preventDefault();
  if (state.phase !== "answering") return;
  const raw = input.value.trim();
  if (!raw) return;
  const p = prompts[state.i];
  const api = net();
  const hit = match(p.index, raw);
  if (hit) {
    if (api) api.record(p.id, raw); // instant either way; the server just keeps count
    return settle(p.answers[hit.i]);
  }
  // A known-wrong answer is refused at once, with its reason: no server, no wait.
  const wrong = matchWrong(p.index, raw);
  if (wrong) return reject(raw, wrong.why);
  if (!api) return reject(raw);

  // Not in the bank: the server may still know it (or a judge may). Hold the
  // clock while it thinks so the wait never costs the player time.
  const i = state.i;
  const left = state.deadline - performance.now();
  state.phase = "checking";
  cancelAnimationFrame(state.raf);
  input.disabled = true;
  msg.textContent = "Checking that answer…";
  const verdict = await api.check(p.id, raw);
  if (state.phase !== "checking" || state.i !== i) return;
  if (verdict && verdict.valid) return settle(verdict.answer);
  if (verdict && verdict.locked) return settle(null);
  state.phase = "answering";
  state.deadline = performance.now() + left;
  input.disabled = false;
  input.focus({ preventScroll: true });
  tick();
  reject(raw);
}

function reject(raw, why) {
  state.misses++;
  msg.textContent = why ? `"${raw}" doesn't count. ${why}` : `"${raw}" is not on today's list. Try another, the clock is still running.`;
  field.classList.remove("nope");
  void field.offsetWidth; // restart the shake
  field.classList.add("nope");
  input.select();
}

// Lock the round in. `ans` is the matched answer, or null when time ran out.
// The score is not shown at once: it counts up over about a second while the
// billboard and the pin on the scale climb through the tiers with it.
function settle(ans) {
  cancelAnimationFrame(state.raf);
  state.phase = "scoring";
  input.disabled = true;
  input.blur();

  const i = state.i, p = prompts[i];
  const pts = ans ? ans.pts : 0;
  const tier = tierIndex(pts);
  const before = state.score;
  state.score += pts;
  state.results[i] = { id: p.id, a: ans ? ans.a : null, pts, tier };

  // billboard
  face.innerHTML =
    `<div class="verdict"><div class="verdict-main"><p class="verdict-tier"></p>` +
    `<p class="verdict-ans">${ans ? esc(ans.a) : "No answer shipped"}</p></div><b class="verdict-pts"></b></div>` +
    (ans && ans.fact ? `<p class="fact">${esc(ans.fact)}</p>` : "");
  const verdict = face.querySelector(".verdict");
  const tierEl = face.querySelector(".verdict-tier"), ptsEl = face.querySelector(".verdict-pts");

  // what it did to the company, and where it sat among the accepted answers
  const sorted = [...p.answers].sort((x, y) => x.pts - y.pts);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const last = i === N - 1;
  const m = multiple(pts);
  after.innerHTML =
    (pts
      ? `<p class="raise"><span class="was">${money(valuation(before))}</span><i class="to" role="img" aria-label="to"></i>` +
        `<b>${money(valuation(state.score))}</b><span class="mult">${m >= 10 ? "10" : m.toFixed(1)}x</span></p>`
      : `<p class="raise flat">No raise this round. Your valuation holds at <b>${money(valuation(before))}</b>.</p>`) +
    `<div class="scale" aria-hidden="true"><div class="scale-bar">` +
    BAND_FLEX.map((w, k) => `<i style="flex:${w};background:${TIERS[k + 1].color}"></i>`).join("") +
    `</div>${pts ? `<span class="scale-pin"></span>` : ""}</div>` +
    `<dl class="ends"><div><dt>Most common</dt><dd>${esc(lo.a)}<span>${lo.pts}</span></dd></div>` +
    `<div><dt>Rarest of ${p.answers.length}</dt><dd>${esc(hi.a)}<span>${hi.pts}</span></dd></div></dl>` +
    `<button class="btn btn-go" id="nextBtn" type="button">${last ? "See your IPO" : `Next round: ${esc(STAGES[i + 1])}`}</button>`;
  const pin = after.querySelector(".scale-pin");
  $("#nextBtn").addEventListener("click", next);

  // Show the score as it stands at `n` points.
  let painted = -1;
  const paint = (n) => {
    const t = pts ? tierIndex(Math.max(10, n)) : 0;
    ptsEl.textContent = `+${n}`;
    if (pin) pin.style.left = (scalePosition(n) * 100).toFixed(2) + "%";
    if (t === painted) return;
    painted = t;
    face.style.setProperty("--tier", TIERS[t].color);
    after.style.setProperty("--tier", TIERS[t].color);
    tierEl.textContent = TIERS[t].name;
    const old = verdict.querySelector(".icon");
    if (old) old.remove();
    verdict.prepend(tierIcon(TIERS[t].key));
  };

  // The count has finished: show the rest and let the street react.
  const land = () => {
    paint(pts);
    state.phase = "reveal";
    face.classList.remove("counting");
    after.classList.remove("pending");
    ptsEl.classList.add("landed");
    renderPips();
    $("#nextBtn").focus({ preventScroll: true });
    rollValuation(before, state.score);
    scene.cheer(tier, [TIERS[tier].color, "#ffffff", "#ffc93c"]);
    if (pts && !reduced) {
      pop.style.setProperty("--tier", TIERS[tier].color);
      pop.textContent = `+${pts}`;
      pop.classList.remove("go");
      void pop.offsetWidth;
      pop.classList.add("go");
    }
  };

  play.hidden = true;
  after.hidden = false;
  if (!pts || reduced) return land();

  face.classList.add("counting");
  after.classList.add("pending");
  paint(0);
  const t0 = performance.now(), dur = Math.min(1250, 420 + pts * 8);
  const step = (now) => {
    if (state.phase !== "scoring" || state.i !== i) return; // the screen moved on
    const u = Math.min(1, (now - t0) / dur);
    paint(Math.round(pts * (1 - Math.pow(1 - u, 3))));
    if (u < 1) state.raf = requestAnimationFrame(step);
    else land();
  };
  state.raf = requestAnimationFrame(step);
}

function next() {
  if (state.phase !== "reveal") return;
  if (state.i + 1 < N) startRound(state.i + 1);
  else showFinal(!practice);
}

// ------------------------------------------------------------------- final
function showFinal(save) {
  state.phase = "final";
  cancelAnimationFrame(state.raf);
  setScreen("final");
  scene.goTo(N - 1, true);
  if (save) store.set({ score: state.score, results: state.results });
  const api = net();
  const { score, results } = state; // the replay may start before the server answers

  $("#finalVal").textContent = money(valuation(state.score));
  $("#finalClass").textContent = companyClass(state.score);
  $("#finalPts").textContent = `${state.score} of ${N * 100} points`;
  $("#recap").innerHTML = prompts.map((p, k) => {
    const r = state.results[k] || { pts: 0, tier: 0, a: null };
    const T = TIERS[r.tier];
    return `<li style="--tier:${T.color}"><span class="pts">${r.pts}</span><div><p class="q">${esc(STAGES[k])}: ${esc(p.q)}</p>` +
      `<p class="a">${r.a ? esc(r.a) : "No answer"}<span>${esc(T.name)}</span></p></div></li>`;
  }).join("");
  // Start from the estimate so the screen never waits on the network, then
  // swap in the real tally when the server answers (kept in the save so a
  // reload can draw it too).
  const draw = (dist) => {
    if (state.phase !== "final") return;
    estimate = estimate || estimateDay(prompts);
    renderDistribution($("#dist"), dist ? fromServer(dist, prompts) : estimate, state.score, dist ? dist.players : 0, practice);
  };
  const kept = practice ? null : store.get(); // a practice run never shows the first game's tally
  draw(kept && kept.dist);
  $("#finalBoard").hidden = true;
  $("#addName").hidden = true;
  if (serverApi) renderBoard($("#finalBoard"), null);
  if (save && api) {
    api.finish(runName, source.src).then((r) => {
      if (!r) { loadFinalBoard(); return; }
      // The score on screen stays the one computed here; a mismatch is a bug worth hearing about.
      if (r.score !== score) console.warn(`sloprillion: server scored ${r.score}, page scored ${score}`);
      const dist = { counts: r.dist.counts, players: r.dist.players ?? r.dist.counts.reduce((a, b) => a + b, 0) };
      store.set({ score, results, dist });
      if (practice) return; // a replay may have started while the server thought
      draw(dist);
      showFinalBoard(r.board, r.nameError);
    });
  } else if (serverApi) {
    loadFinalBoard(); // a result from earlier today, or a practice run: the board as it stands
  }
  countdown();
}

function loadFinalBoard() {
  serverApi.board().then((board) => showFinalBoard(board));
}

// The board on the results screen. A first result that is not on it yet
// (no name given, or the name was refused) gets the form to add one.
function showFinalBoard(board, nameError) {
  if (state.phase !== "final") return;
  renderBoard($("#finalBoard"), board);
  const canAdd = !!board && !board.you && !practice && !!store.get();
  $("#addName").hidden = !canAdd;
  if (!canAdd) return;
  const field = $("#addNameInput");
  if (!field.value) field.value = nameError ? runName : keptName.get();
  say($("#addNameMsg"), nameError && NAME_HELP[nameError]);
}

async function addName(e) {
  e.preventDefault();
  const field = $("#addNameInput"), btn = $("#addNameBtn"), note = $("#addNameMsg");
  const name = tidyName(field.value), problem = nameProblem(name);
  say(note, problem && NAME_HELP[problem]);
  if (problem) { field.focus(); return; }
  btn.disabled = true;
  const r = await serverApi.finish(name, source.src);
  btn.disabled = false;
  if (!r) { say(note, "The leaderboard can't be reached right now. Try again."); return; }
  if (!r.nameError) keptName.set(name);
  showFinalBoard(r.board, r.nameError);
}

function shareText() {
  const grid = prompts.map((_, k) => TIERS[state.results[k] ? state.results[k].tier : 0].emoji).join("");
  return `Sloprillion #${dayNo}\n${money(valuation(state.score))} valuation, ${companyClass(state.score)} (${state.score}/${N * 100})\n${grid}`;
}

async function share() {
  const btn = $("#shareBtn"), text = shareText();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  btn.textContent = ok ? "Copied" : "Copy failed";
  setTimeout(() => { btn.textContent = "Copy result"; }, 1800);
}

let countdownTimer = 0;
function countdown() {
  clearInterval(countdownTimer);
  const el = $("#nextIn");
  const paint = () => {
    const now = new Date(), mid = new Date(now);
    mid.setHours(24, 0, 0, 0);
    const s = Math.max(0, Math.floor((mid - now) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = `Next round in ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  };
  paint();
  countdownTimer = setInterval(paint, 1000);
}

// -------------------------------------------------------------------- wire
$("#startForm").addEventListener("submit", begin);
$("#addName").addEventListener("submit", addName);
$("#form").addEventListener("submit", submit);
input.addEventListener("input", () => { if (state.phase === "answering") msg.textContent = ""; });
$("#shareBtn").addEventListener("click", share);
$("#againBtn").addEventListener("click", () => { practice = true; startGame(); }); // the first result stays saved

renderLegend();

// Dev entry points, used for screenshots while there is no backend:
//   ?screen=game&round=3&freeze      a prompt with the clock held
//   ?screen=reveal&round=3&answer=mish
//   ?screen=final
function fakeThrough(n) {
  const picks = [0.1, 0.55, 0.3, 0.8, 0.45, 1, 0.7];
  for (let k = 0; k < n; k++) {
    const p = prompts[k], ans = p.answers[Math.min(p.answers.length - 1, Math.floor(p.answers.length * picks[k % picks.length]))];
    state.results[k] = { id: p.id, a: ans.a, pts: ans.pts, tier: tierIndex(ans.pts) };
    state.score += ans.pts;
  }
}

const dev = query.get("screen");
const saved = store.get();
if (dev === "game" || dev === "reveal") {
  const r = Math.max(0, Math.min(N - 1, Number(query.get("round") || 0)));
  fakeThrough(r);
  setScreen("game");
  $("#hudVal").textContent = money(valuation(state.score));
  startRound(r, true);
  if (dev === "reveal") {
    const hit = query.get("answer") ? match(prompts[r].index, query.get("answer")) : null;
    settle(hit ? prompts[r].answers[hit.i] : null);
  }
} else if (dev === "final") {
  fakeThrough(N);
  showFinal(false);
} else if (saved && Array.isArray(saved.results)) {
  state.score = saved.score; state.results = saved.results;
  showFinal(false);
} else {
  showIntro();
}
