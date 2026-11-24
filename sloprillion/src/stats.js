// The owner's page (stats.html), in three parts: visitors to the site and the
// game by day and source, one day's play (the board, what players answered,
// what the judge decided), and the rounds coming up. The first two come from
// the API, asked with a key that is typed once and kept in this browser;
// without the key the API says nothing and the page shows nothing.

import { calendar, pickByDate, dayNumber, daysLeft, daysBetween, loadRound } from "./rounds/index.js";
import { localDate } from "./visits.js";

const $ = (s) => document.querySelector(s);
const KEY = "sloprillion:stats-key";
const DAYS = 30; // days of visitors asked for
const AHEAD = 7; // days of rounds shown in "Coming up"
const SHOWN = 8; // rows of a list before the rest folds away
const KEPT_DAYS = 14; // how long the server keeps a day's board and judge count
const JUDGE_COST = 1.29 / 1000; // dollars per judge call, from the model benchmark

const query = new URLSearchParams(location.search);
const named = query.get("api") || document.querySelector('meta[name="sloprillion-api"]')?.content || "";
const api = (named.trim() === "local" ? "http://localhost:8787" : named.trim()).replace(/\/+$/, "");

const today = localDate();
let key = "";
let viewDate = today; // the day shown in "The day's play"

const kept = {
  get() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } },
  set(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* typed again next time */ } },
};

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const longDay = (date) => new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const shortDay = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const plural = (n, word) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
const shift = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const fromApi = (path, params) => fetch(`${api}${path}?${new URLSearchParams({ key, ...params })}`);

function ask(problem) {
  $("#page").hidden = true;
  $("#loading").hidden = true;
  $("#keyForm").hidden = false;
  const msg = $("#keyMsg");
  msg.hidden = !problem;
  msg.textContent = problem || "";
  $("#key").focus();
}

// A list that shows its first rows and folds the rest under "N more".
function folded(items, row, empty) {
  const box = el("div");
  if (!items.length) {
    box.append(el("p", "none", empty));
    return box;
  }
  const first = el("ul", "rows");
  first.append(...items.slice(0, SHOWN).map(row));
  box.append(first);
  if (items.length > SHOWN) {
    const more = el("details"), rest = el("ul", "rows");
    rest.append(...items.slice(SHOWN).map(row));
    more.append(el("summary", null, `${items.length - SHOWN} more`), rest);
    box.append(more);
  }
  return box;
}

// ---------------------------------------------------------------- visitors
function tile(value, label, detail) {
  const box = el("div", "tile");
  box.append(el("b", null, String(value)), el("span", null, label), el("small", null, detail));
  return box;
}

function renderVisitors(days) {
  const now = days[0] || { site: 0, game: 0, finished: 0 };
  const week = days.slice(0, 7);
  const sum = (field) => week.reduce((n, d) => n + d[field], 0);
  $("#tiles").replaceChildren(
    tile(now.site, "site visitors today", `${sum("site")} in the last 7 days`),
    tile(now.game, "game visitors today", `${sum("game")} in the last 7 days`),
    tile(now.finished, "games finished today", `${sum("finished")} in the last 7 days`),
  );

  // Days older than the first one with anything recorded are left off, so the
  // table starts where the counting did.
  const busy = (d) => d.site + d.game + d.finished > 0;
  const shown = days.slice(0, Math.max(1, days.findLastIndex(busy) + 1));

  const body = $("#days");
  body.replaceChildren();
  for (const day of shown) {
    const row = el("tr", "day" + (busy(day) ? "" : " quiet"));
    const name = el("td", null, longDay(day.date));
    name.append(el("span", "round", `round ${day.round}`));
    row.append(name, el("td", null, day.site), el("td", null, day.game), el("td", null, day.finished));
    body.append(row);
    for (const s of day.sources) {
      const line = el("tr", "src");
      line.append(el("td", null, s.src), el("td", null, s.site), el("td", null, s.game), el("td", null, s.finished));
      body.append(line);
    }
  }
}

// ------------------------------------------------------------ the day's play
async function loadDay(date) {
  viewDate = date;
  $("#dayName").textContent = date === today ? `${longDay(date)}, today` : longDay(date);
  $("#later").disabled = date >= today;
  const body = $("#dayBody");
  body.replaceChildren(el("p", "note", "Loading the day."));
  let data;
  try {
    const res = await fromApi("/v1/day", { date });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (viewDate === date) body.replaceChildren(el("p", "problem", "This day could not be loaded. Try again in a minute."));
    return;
  }
  if (viewDate === date) renderDay(data); // a later click may have moved on
}

// When a verdict was reached, if that was not on the day being shown: a round
// keeps its verdicts, so a replayed round arrives with the ones from last time.
const whenNote = (at, date) => (at && localDate(new Date(at)) !== date ? ` (${shortDay(at)})` : "");

function renderDay(d) {
  const body = $("#dayBody");
  body.replaceChildren();

  const cost = d.judge.used * JUDGE_COST;
  const head = el("p", "note");
  head.append(
    el("strong", null, `Round ${d.round}`), `, played as day ${d.day}. `,
    el("strong", null, plural(d.players, "game")), " finished. ",
    `The judge was asked ${plural(d.judge.used, "time")} on that UTC day, of ${d.judge.cap.toLocaleString("en-GB")} allowed`,
    d.judge.used ? `, about ${cost < 0.01 ? "under a cent" : "$" + cost.toFixed(2)}.` : ".",
  );
  body.append(head);
  if (daysBetween(d.date, today) > KEPT_DAYS) {
    body.append(el("p", "note", "The board and the judge count are kept for two weeks, so they read as empty here. The answers stay."));
  }

  const board = el("div", "block");
  board.append(el("h3", null, "On the board"));
  if (d.board.length) {
    const list = el("ol", "names");
    for (const row of d.board) {
      const li = el("li");
      li.append(el("i", null, row.rank), el("span", null, row.name), el("b", null, row.score));
      list.append(li);
    }
    board.append(list);
  } else {
    board.append(el("p", "none", "Nobody has put a name on the board."));
  }
  body.append(board);

  for (const p of d.prompts) {
    const box = el("article", "asked");
    box.append(el("h3", null, p.q));
    box.append(el("p", null, p.given
      ? `${plural(p.given, "accepted answer")}, ${p.distinct} different`
      : "No accepted answers yet"));

    const cols = el("div", "cols");
    const said = el("div"), letIn = el("div"), turned = el("div");
    said.append(el("h4", null, "What players said"), folded(p.answers, (x) => {
      const li = el("li"), name = el("span", null, x.a);
      if (x.pts != null) name.append(el("span", "pts", `  ${x.pts} pts`));
      li.append(name, el("b", null, x.n));
      return li;
    }, "Nothing yet."));
    letIn.append(el("h4", null, "Let in by the judge"), folded(p.accepted, (x) => {
      const li = el("li");
      li.append(el("span", null, x.a), el("span", "pts", `${x.pts} pts`));
      const about = x.bank ? "Already in the bank, under another spelling" : "Not in the bank";
      const typed = x.said.length ? `; typed as ${x.said.map((s) => `"${s}"`).join(", ")}` : "";
      li.append(el("small", null, about + typed + whenNote(x.at, d.date)));
      return li;
    }, "Nothing yet."));
    turned.append(el("h4", null, "Turned away by the judge"), folded(p.refused, (x) => {
      const li = el("li");
      li.append(el("span", null, x.text), el("small", null, (x.why || "No reason given.") + whenNote(x.at, d.date)));
      return li;
    }, "Nothing yet."));
    cols.append(said, letIn, turned);
    box.append(cols);
    body.append(box);
  }
}

// ---------------------------------------------------------------- coming up
const loading = new Map(); // round id -> promise of the round, so a repeat is fetched once
const roundFor = (entry) => {
  if (!loading.has(entry.id)) loading.set(entry.id, loadRound(entry));
  return loading.get(entry.id);
};

function fillRound(list, round) {
  list.replaceChildren();
  for (const p of round.prompts) {
    const byPts = [...p.answers].sort((x, y) => x.pts - y.pts);
    const common = byPts[0], rare = byPts[byPts.length - 1];
    const li = el("li"), q = el("div", "q", p.q);
    q.append(el("span", "cat", p.category));
    li.append(q);
    if (p.note) li.append(el("small", null, p.note));
    li.append(el("small", null, `${p.answers.length} answers, from ${common.a} (${common.pts} pts) to ${rare.a} (${rare.pts} pts)`));

    // The full list is only built when it is opened: a round holds some 1,400 answers.
    const all = el("details");
    all.append(el("summary", null, "Every answer"));
    all.addEventListener("toggle", () => {
      if (!all.open || all.childElementCount > 1) return;
      const answers = el("ol", "all");
      for (const x of byPts) {
        const row = el("li");
        row.append(el("span", null, x.a), el("b", null, x.pts));
        answers.append(row);
      }
      all.append(answers);
      if (p.wrong?.length) {
        const barred = el("ul", "barred");
        for (const w of p.wrong) {
          const row = el("li");
          row.append(el("b", null, w.a), `: ${w.why}`);
          barred.append(row);
        }
        all.append(el("h4", null, "Refused on the spot, with the reason shown"), barred);
      }
    });
    li.append(all);
    list.append(li);
  }
}

function renderComing() {
  const last = calendar[calendar.length - 1], left = daysLeft(calendar, today);
  $("#roundsLeft").textContent = left > 0
    ? `New rounds are written up to ${longDay(last.date)}: ${plural(left, "more day")} after today. After that the game replays old rounds, one a day.`
    : "The written rounds have run out, so the game is replaying old ones, one a day.";

  const box = $("#coming");
  box.replaceChildren();
  for (let i = 1; i <= AHEAD; i++) {
    const date = shift(today, i), entry = pickByDate(calendar, date);
    const card = el("article", "up"), head = el("header"), list = el("ol", "qs");
    const which = date > last.date ? `day ${dayNumber(calendar, date)}, round ${entry.id} again` : `round ${entry.id}`;
    const preview = el("a", null, "Play it as a preview");
    preview.href = `./?api=off&day=${entry.id}`;
    head.append(el("h3", null, longDay(date)), el("span", "which", which), preview);
    const wait = el("p", "none", "Loading the questions.");
    card.append(head, wait, list);
    box.append(card);
    roundFor(entry).then(
      (round) => { wait.remove(); fillRound(list, round); },
      () => { wait.className = "problem"; wait.textContent = "This round's file could not be loaded."; },
    );
  }
}

// ------------------------------------------------------------------ sign-in
async function show(tried) {
  if (!api) return ask("This page does not name an API.");
  key = tried;
  $("#keyForm").hidden = true;
  $("#loading").hidden = false;
  let res;
  try {
    res = await fromApi("/v1/stats", { to: today, days: DAYS });
  } catch {
    return ask("The API could not be reached. Check the connection and try again.");
  }
  if (res.status === 404) { kept.set(""); return ask("That key was not accepted."); }
  if (!res.ok) return ask(`The API answered with an error (${res.status}). Try again in a minute.`);
  const data = await res.json();
  kept.set(key);
  renderVisitors(Array.isArray(data.days) ? data.days : []);
  renderComing();
  $("#loading").hidden = true;
  $("#page").hidden = false;
  loadDay(today);
}

$("#keyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const typed = $("#key").value.trim();
  if (typed) show(typed); else ask("Type the key first.");
});
$("#forget").addEventListener("click", () => { kept.set(""); key = ""; $("#key").value = ""; ask(); });
$("#earlier").addEventListener("click", () => loadDay(shift(viewDate, -1)));
$("#later").addEventListener("click", () => { if (viewDate < today) loadDay(shift(viewDate, 1)); });

// A link ending in #key=... signs in once and then drops the key from the address bar.
function start() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("key");
  if (fromLink) history.replaceState(null, "", location.pathname + location.search);
  const known = fromLink || kept.get();
  if (known) show(known); else ask();
}
addEventListener("hashchange", () => { if (location.hash.includes("key=")) start(); });
start();
