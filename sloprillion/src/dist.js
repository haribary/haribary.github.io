// How the day's players scored, drawn as one smooth curve on the final screen.
//
// The curve starts as an estimate built from the rarity scores themselves
// (estimateDay). With a backend, fromServer() blends in the real tally of final
// scores, trusting it more as more people play.

import { valuation, money } from "./config.js";

const MAX = 700;
const TICKS = ["$100K", "$1M", "$10M", "$100M", "$1B", "$10B", "$100B", "$1T"]; // every 100 points
const SVG = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- estimate
// Three kinds of player. `half` is how many points of rarity it takes for an
// answer to be picked half as often; `miss` is how often they run out of time.
const CROWD = [
  { share: 0.3, half: 9, miss: 0.2 },    // says the obvious thing
  { share: 0.45, half: 14, miss: 0.1 },
  { share: 0.25, half: 22, miss: 0.05 }, // hunts for rare answers
];

function roundOdds(prompt, half, miss) {
  const odds = new Float64Array(101);
  const weights = prompt.answers.map((a) => Math.pow(2, -(a.pts - 10) / half));
  const total = weights.reduce((x, y) => x + y, 0);
  prompt.answers.forEach((a, i) => { odds[a.pts] += ((1 - miss) * weights[i]) / total; });
  odds[0] += miss;
  return odds;
}

function convolve(a, b) {
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) if (b[j]) out[i + j] += a[i] * b[j];
  }
  return out;
}

export function estimateDay(prompts) {
  return fromCounts(estimateCounts(prompts));
}

function estimateCounts(prompts) {
  const counts = new Float64Array(MAX + 1);
  for (const kind of CROWD) {
    let total = Float64Array.of(1);
    for (const p of prompts) total = convolve(total, roundOdds(p, kind.half, kind.miss));
    for (let s = 0; s <= MAX && s < total.length; s++) counts[s] += kind.share * total[s];
  }
  return counts;
}

// The server's 71 ten-point buckets, spread evenly over each bucket's ten
// scores (the last bucket is just 700), blended with the estimate. Both are
// shares of one player; the real one weighs players / (players + PRIOR), so a
// few early results nudge the curve instead of making it jagged.
const PRIOR = 30;
export function fromServer(dist, prompts) {
  const real = new Float64Array(MAX + 1);
  let n = 0;
  dist.counts.forEach((c, b) => {
    n += c;
    if (b * 10 >= MAX) real[MAX] += c;
    else for (let k = 0; k < 10; k++) real[b * 10 + k] += c / 10;
  });
  const guess = estimateCounts(prompts);
  let g = 0;
  for (const v of guess) g += v;
  const w = n / (n + PRIOR);
  const mix = real.map((v, s) => (n ? (w * v) / n : 0) + ((1 - w) * guess[s]) / g);
  return fromCounts(mix);
}

// counts[s] is how many players (or what share) finished on s points.
// Returns a smoothed density for drawing and an exact running total for ranks.
export function fromCounts(counts, bandwidth = 12) {
  const n = counts.length;
  let total = 0;
  for (let s = 0; s < n; s++) total += counts[s];
  const cdf = new Float64Array(n);
  let run = 0;
  for (let s = 0; s < n; s++) { run += counts[s] / total; cdf[s] = run; }

  const r = Math.ceil(bandwidth * 3);
  const kernel = new Float64Array(2 * r + 1);
  let ksum = 0;
  for (let k = -r; k <= r; k++) { kernel[k + r] = Math.exp(-(k * k) / (2 * bandwidth * bandwidth)); ksum += kernel[k + r]; }
  const density = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    let v = 0;
    for (let k = -r; k <= r; k++) {
      let j = s + k;
      if (j < 0) j = -j;                 // reflect at the ends so no weight leaks off the chart
      if (j > n - 1) j = 2 * (n - 1) - j;
      v += counts[j] * kernel[k + r];
    }
    density[s] = v / ksum / total;
  }
  return { density, cdf };
}

const clampScore = (s) => Math.max(0, Math.min(MAX, Math.round(s)));

// Share of players who finished below `score`. Ties count as half.
export function shareBelow(model, score) {
  const s = clampScore(score);
  const below = s > 0 ? model.cdf[s - 1] : 0;
  return below + (model.cdf[s] - below) / 2;
}

function scoreAtShare(model, q) {
  for (let s = 0; s <= MAX; s++) if (model.cdf[s] >= q) return s;
  return MAX;
}

const shortMoney = (v) => money(v).replace(/\.0+(?=[KMBT])/, "").replace(/(\.\d*[1-9])0+(?=[KMBT])/, "$1");
const pctText = (f) => (f >= 0.995 ? "over 99%" : f < 0.01 ? "under 1%" : Math.round(f * 100) + "%");

// ------------------------------------------------------------------ drawing
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

let current = null; // { root, model, score }
let observer = null;

// `players` is set once the day has enough real results to say so. A practice
// run is a replay that never reached the server, and the note says so.
export function renderDistribution(root, model, score, players = 0, practice = false) {
  current = { root, model, score: clampScore(score) };
  const ahead = shareBelow(model, score);
  const lo = scoreAtShare(model, 0.1), hi = scoreAtShare(model, 0.9);
  root.querySelector(".dist-title").textContent =
    players >= PRIOR ? `Ahead of ${pctText(ahead)} of today's ${players} players` : `Ahead of ${pctText(ahead)} of today's players`;
  root.querySelector(".dist-note").textContent = (
    `Most players finish between ${shortMoney(valuation(lo))} and ${shortMoney(valuation(hi))}. ` +
    (players >= PRIOR ? "" : `This curve is an estimate from the rarity scores until real results come in. `) +
    (practice ? "This was a practice run, so it is not counted." : "")).trim();
  const plot = root.querySelector(".dist-plot");
  if (!observer) { observer = new ResizeObserver(draw); observer.observe(plot); }
  draw();
}

function draw() {
  if (!current) return;
  const { root, model, score } = current;
  const plot = root.querySelector(".dist-plot");
  const W = plot.clientWidth, H = plot.clientHeight;
  if (!W || !H) return;

  // The axis stops a little past the last player (or past you), rounded up to
  // the next 10x, so the curve fills the width instead of hugging the left.
  const END = Math.min(MAX, Math.ceil((Math.max(scoreAtShare(model, 0.999), score) + 40) / 100) * 100);
  const padX = 10, top = 34, base = H - 24;
  const x = (s) => padX + (s / END) * (W - padX * 2);
  let peak = 0;
  for (let s = 0; s <= END; s++) if (model.density[s] > peak) peak = model.density[s];
  const y = (s) => base - (model.density[s] / peak) * (base - top);

  const pts = [];
  for (let s = 0; s <= END; s += 2) pts.push(s);
  const line = (from, to) => pts.filter((s) => s >= from && s <= to).map((s) => `${x(s).toFixed(1)},${y(s).toFixed(1)}`);
  const area = (from, to, x0, x1) =>
    `M${x0.toFixed(1)},${base} L${x0.toFixed(1)},${y(from).toFixed(1)} L${line(from, to).join(" L")} L${x1.toFixed(1)},${y(to).toFixed(1)} L${x1.toFixed(1)},${base} Z`;

  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" });
  svg.setAttribute("aria-label",
    `${root.querySelector(".dist-title").textContent}. ${root.querySelector(".dist-note").textContent}`);

  // the crowd: everyone behind you is the stronger wash, everyone ahead the lighter one
  const mx = x(score);
  if (score > 0) svg.append(el("path", { class: "dist-behind", d: area(0, score, x(0), mx - 1) }));
  if (score < END) svg.append(el("path", { class: "dist-ahead", d: area(score, END, mx + 1, x(END)) }));
  svg.append(el("path", { class: "dist-line", d: "M" + line(0, END).join(" L") }));

  // axis: valuation, ten times bigger every 100 points
  svg.append(el("line", { class: "dist-axis", x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5 }));
  const nTicks = END / 100 + 1;
  const stepTicks = W / nTicks < 54 ? 2 : 1;
  TICKS.slice(0, nTicks).forEach((label, i) => {
    const last = i === nTicks - 1;
    if (i % stepTicks) return;
    const tx = x(i * 100);
    svg.append(el("line", { class: "dist-axis", x1: tx, x2: tx, y1: base, y2: base + 4 }));
    const t = el("text", { class: "dist-tick", x: tx, y: H - 5, "text-anchor": i === 0 ? "start" : last ? "end" : "middle" });
    if (i === 0) t.setAttribute("x", tx - 4);
    if (last) t.setAttribute("x", tx + 4);
    t.textContent = label;
    svg.append(t);
  });

  // you
  const chipW = 38, chipX = Math.max(0, Math.min(W - chipW, mx - chipW / 2));
  svg.append(el("line", { class: "dist-you", x1: mx, x2: mx, y1: base, y2: 22 }));
  svg.append(el("circle", { class: "dist-you-dot", cx: mx, cy: y(score), r: 5 }));
  const chip = el("g", { class: "dist-chip" });
  chip.append(el("rect", { x: chipX, y: 2, width: chipW, height: 20 }));
  const you = el("text", { x: chipX + chipW / 2, y: 16, "text-anchor": "middle" });
  you.textContent = "You";
  chip.append(you);
  svg.append(chip);

  // hover and touch: read any point on the curve
  const cross = el("line", { class: "dist-cross", y1: top - 6, y2: base, visibility: "hidden" });
  svg.append(cross);
  let tip = plot.querySelector(".dist-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "dist-tip";
    tip.hidden = true;
    tip.append(document.createElement("b"), document.createElement("span"));
  }
  const show = (ev) => {
    const box = plot.getBoundingClientRect();
    const s = Math.min(END, clampScore(((ev.clientX - box.left - padX) / (W - padX * 2)) * END));
    cross.setAttribute("x1", x(s)); cross.setAttribute("x2", x(s));
    cross.setAttribute("visibility", "visible");
    tip.firstChild.textContent = shortMoney(valuation(s));
    tip.lastChild.textContent = `ahead of ${pctText(shareBelow(model, s))}`;
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.max(half, Math.min(W - half, x(s))) + "px";
    tip.style.top = Math.max(0, y(s) - 52) + "px";
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);

  plot.replaceChildren(svg, tip);
}
