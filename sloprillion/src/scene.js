// The street. One long pixel-art road with seven lots, one per funding round:
// garage, hacker house, first office, the city, the campus, the datacenter and
// the exchange. The camera pans a lot per round and the day runs from dawn to
// night as it goes.

import { drawText, textW, SPR } from "./sprites.js";

const LOT = 176;       // logical width of one lot
const ROAD = 24;       // logical height of kerb + road at the bottom
const LOTS = 7;
const PAN_MS = 1100;
const ROAD_COL = "#2a2c38"; // must match --road in style.css so the page continues the tarmac
const INK = "#14151c";

// ------------------------------------------------------------------ colour
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function ramp(table, t) {
  const i = clamp(t, 0, table.length - 1);
  const a = Math.min(Math.floor(i), table.length - 2);
  return mix(table[a], table[a + 1], i - a);
}
function rampN(table, t) {
  const i = clamp(t, 0, table.length - 1);
  const a = Math.min(Math.floor(i), table.length - 2);
  return table[a] + (table[a + 1] - table[a]) * (i - a);
}

// One entry per lot: dawn, morning, noon, fog, golden hour, dusk, night.
const SKY_TOP = ["#3b3470", "#4a9be0", "#2f86de", "#6f93b5", "#5d6fc4", "#2a1f5c", "#0c0b24"].map(hex);
const SKY_MID = ["#b0628c", "#86c2f2", "#6fb7f5", "#a9c0d3", "#f0a35e", "#a2477a", "#1a1748"].map(hex);
const SKY_BOT = ["#ffb37a", "#d9f0ff", "#c4e8ff", "#dfe7ec", "#ffd98a", "#f48a5a", "#32276b"].map(hex);
const HILL = ["#5a4a80", "#6fa58a", "#5f9c80", "#8aa3ad", "#b0785a", "#4a2f68", "#161338"].map(hex);
const SKYLINE = ["#6b5a8e", "#8fb5c9", "#7fa9c2", "#9fb4c2", "#c98f63", "#5b3a78", "#221c4d"].map(hex);
const CLOUD = ["#ffd2c2", "#ffffff", "#ffffff", "#eef2f5", "#ffe2b8", "#e9a0a8", "#3a3470"].map(hex);
const SUN = ["#ffd9a0", "#fff6c9", "#fffbe0", "#f4f1e4", "#ffe08a", "#ff9a6b", "#ff9a6b"].map(hex);
const TINT = [[120, 70, 130], [0, 0, 0], [0, 0, 0], [190, 205, 220], [255, 150, 60], [60, 30, 100], [14, 10, 48]];
const TINT_A = [0.2, 0, 0, 0.16, 0.16, 0.42, 0.58];
const LIT = [0.55, 0, 0, 0.12, 0.25, 0.85, 1];
const SUN_Y = [0.86, 0.42, 0.2, 0.26, 0.5, 0.92, 1.4];

export function createScene(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext("2d");
  const near = document.createElement("canvas");
  const nctx = near.getContext("2d");
  const tile = document.createElement("canvas");
  tile.width = tile.height = 2;
  const tctx = tile.getContext("2d");

  let W = 0, H = 0, GY = 0, scale = 2;
  let cam = LOT / 2, camFrom = cam, camTo = cam, camT0 = -1e9;
  let target = 0;
  let hopT0 = -1e9, hopN = 1;
  let last = 0, alive = true;
  const parts = [];
  const cars = [
    { kind: "taxi", x: -220, v: 34, dir: 1 },
    { kind: "bus", x: 520, v: 22, dir: -1 },
    { kind: "bot", x: 260, v: 7, dir: -1 },
  ];
  let fwNext = 0;

  let c = ctx; // the context the helpers below draw into
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const T = (str, x, y, col, s) => drawText(c, str, x, y, col, s);

  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // whole-number zoom: as big as the height allows, but never so tight that a lot no longer fits
    scale = Math.max(2, Math.min(Math.round(box.height / 128), Math.floor(box.width / 128)));
    W = Math.ceil(box.width / scale);
    H = Math.ceil(box.height / scale);
    canvas.width = near.width = W;
    canvas.height = near.height = H;
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
    GY = H - ROAD;
    if (reduced) draw(performance.now());
  }

  // ------------------------------------------------------------ backdrop
  function drawSky(t) {
    const top = ramp(SKY_TOP, t), mid = ramp(SKY_MID, t), bot = ramp(SKY_BOT, t);
    const n = 9, bh = Math.ceil(GY / n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const col = css(u < 0.5 ? mix(top, mid, u * 2) : mix(mid, bot, (u - 0.5) * 2));
      ctx.fillStyle = col;
      ctx.fillRect(0, i * bh, W, bh);
      if (i > 0) {
        // dither the seam: a two-row checker of this band laid over the last
        tctx.clearRect(0, 0, 2, 2);
        tctx.fillStyle = col;
        tctx.fillRect(0, 0, 1, 1);
        tctx.fillRect(1, 1, 1, 1);
        ctx.fillStyle = ctx.createPattern(tile, "repeat");
        ctx.fillRect(0, i * bh - 2, W, 2);
      }
    }
  }

  function disc(cx, cy, r, col) {
    ctx.fillStyle = col;
    for (let y = -r; y <= r; y++) {
      const half = Math.round(Math.sqrt(r * r - y * y));
      ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
    }
  }

  function drawCelestial(t, now) {
    const night = smooth(4.8, 5.9, t);
    const dawnStars = clamp(0.4 - t * 1.1, 0, 0.4);
    const starA = Math.max(night, dawnStars);
    if (starA > 0.02) {
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 70; i++) {
        if ((i * 7 + ((now / 420) | 0)) % 13 === 0) continue; // twinkle
        ctx.globalAlpha = starA * (0.45 + rnd(i * 3.1) * 0.55);
        ctx.fillRect((rnd(i) * W) | 0, (rnd(i + 99) * GY * 0.72) | 0, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    const sy = rampN(SUN_Y, t) * GY;
    if (sy < GY + 8) disc(W * (0.8 - 0.085 * t), sy, 7, css(ramp(SUN, t)));
    if (night > 0.01) {
      const mx = W * 0.57, my = GY * 0.2 + (1 - night) * 30;
      ctx.globalAlpha = night;
      disc(mx, my, 6, "#f3eed6");
      ctx.fillStyle = "#d4cdb0";
      ctx.fillRect((mx - 3) | 0, (my - 2) | 0, 2, 2);
      ctx.fillRect((mx + 1) | 0, (my + 2) | 0, 2, 1);
      ctx.fillRect((mx + 2) | 0, (my - 3) | 0, 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  const CLOUDS = [
    { x: 30, y: 0.16, s: 2.2, k: 0 }, { x: 150, y: 0.3, s: 1.4, k: 1 }, { x: 290, y: 0.1, s: 1.8, k: 1 },
    { x: 420, y: 0.24, s: 1.1, k: 0 }, { x: 560, y: 0.14, s: 2.6, k: 1 },
  ];
  function drawClouds(t, now) {
    const body = css(ramp(CLOUD, t));
    const under = css(mix(ramp(CLOUD, t), ramp(SKY_MID, t), 0.45));
    const span = W + 90;
    for (const cl of CLOUDS) {
      const drift = reduced ? 0 : now * 0.001 * cl.s;
      const x = ((((cl.x - cam * 0.1 + drift) % span) + span) % span) - 45;
      const y = Math.round(GY * cl.y);
      ctx.fillStyle = body;
      if (cl.k === 0) {
        ctx.fillRect(x + 6, y, 12, 3); ctx.fillRect(x + 2, y + 2, 22, 4); ctx.fillRect(x, y + 4, 30, 3);
        ctx.fillStyle = under; ctx.fillRect(x + 2, y + 7, 26, 1);
      } else {
        ctx.fillRect(x + 4, y, 8, 2); ctx.fillRect(x + 1, y + 2, 16, 3); ctx.fillRect(x, y + 4, 20, 2);
        ctx.fillStyle = under; ctx.fillRect(x + 2, y + 6, 16, 1);
      }
    }
  }

  const sx = (worldX, p) => Math.round((worldX - cam) * p + W / 2);

  function drawHills(t) {
    ctx.fillStyle = css(ramp(HILL, t));
    const off = cam * 0.18;
    for (let x = 0; x < W; x += 2) {
      const wx = x + off;
      const h = 22 + Math.sin(wx * 0.021) * 8 + Math.sin(wx * 0.047 + 1.3) * 5 + Math.sin(wx * 0.009 + 4) * 6;
      ctx.fillRect(x, (GY - h) | 0, 2, (h + 1) | 0);
    }
    // broadcast tower on the ridge above the city
    const tx = sx(3.6 * LOT, 0.18);
    if (tx > -20 && tx < W + 20) {
      ctx.fillStyle = css(mix(ramp(HILL, t), ramp(SKY_MID, t), 0.25));
      ctx.fillRect(tx, GY - 62, 1, 34); ctx.fillRect(tx - 4, GY - 54, 1, 26); ctx.fillRect(tx + 4, GY - 54, 1, 26);
      ctx.fillRect(tx - 4, GY - 48, 9, 1); ctx.fillRect(tx - 4, GY - 40, 9, 1);
    }
  }

  function drawBridge(t) {
    const bx = sx(3 * LOT + LOT / 2 + 30, 0.5);
    if (bx < -150 || bx > W + 150) return;
    ctx.fillStyle = css(mix(hex("#c9553e"), ramp(HILL, t), 0.25));
    const deck = GY - 20, th = 44, span = 64, topY = deck - th + 8;
    ctx.fillRect(bx - 120, deck, 240, 2);
    for (const tx of [bx - span / 2, bx + span / 2]) {
      ctx.fillRect(tx - 2, topY, 2, th + 12); ctx.fillRect(tx + 2, topY, 2, th + 12);
      for (let y = topY + 2; y < deck; y += 9) ctx.fillRect(tx - 2, y, 6, 1);
    }
    for (let x = -span / 2; x <= span / 2; x++) {
      const u = x / (span / 2);
      const y = Math.round(topY + 2 + (1 - u * u) * (th - 16));
      ctx.fillRect(bx + x, y, 1, 1);
      if (x % 4 === 0) ctx.fillRect(bx + x, y, 1, deck - y);
    }
    for (let i = 0; i <= 44; i++) {
      const y = Math.round(topY + 2 + (i / 44) * (th - 10));
      ctx.fillRect(bx - span / 2 - 2 - i, y, 1, 1); ctx.fillRect(bx + span / 2 + 3 + i, y, 1, 1);
      if (i % 4 === 0) { ctx.fillRect(bx - span / 2 - 2 - i, y, 1, deck - y); ctx.fillRect(bx + span / 2 + 3 + i, y, 1, deck - y); }
    }
  }

  function drawSkyline(t, lit) {
    const col = css(ramp(SKYLINE, t));
    const p = 0.5, spacing = 26;
    const k0 = Math.floor((cam - W / 2 / p) / spacing) - 1, k1 = Math.ceil((cam + W / 2 / p) / spacing) + 1;
    for (let k = k0; k <= k1; k++) {
      const wx = k * spacing, li = wx / LOT - 0.5;
      const r1 = rnd(k * 3 + 1), r2 = rnd(k * 3 + 2), r3 = rnd(k * 3 + 3);
      const city = smooth(1.4, 3.1, li) * (1 - smooth(6.7, 7.8, li) * 0.7);
      const h = Math.round(7 + r1 * 9 + city * (12 + r2 * 26));
      const w = Math.round(8 + r3 * 7);
      const x = sx(wx, p);
      ctx.fillStyle = col;
      ctx.fillRect(x, GY - h, w, h);
      if (city > 0.5 && r2 > 0.72) ctx.fillRect(x + (w >> 1), GY - h - 5, 1, 5);
      if (city > 0.5 && r2 < 0.18) { ctx.fillRect(x + 2, GY - h - 2, w - 4, 2); ctx.fillRect(x + 4, GY - h - 4, Math.max(1, w - 8), 2); }
      if (lit > 0.05) {
        ctx.fillStyle = "#ffd98a";
        ctx.globalAlpha = lit * 0.9;
        for (let wy = 2; wy < h - 2; wy += 3) for (let wxx = 1; wxx < w - 1; wxx += 2) {
          if (rnd(k * 131 + wy * 17 + wxx * 7) > 0.56) ctx.fillRect(x + wxx, GY - h + wy, 1, 1);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
      }
    }
  }

  function drawFog(t, now) {
    const a = clamp(1 - Math.abs(t - 3) * 0.9, 0, 1);
    if (a < 0.02) return;
    ctx.fillStyle = "#f2f5f7";
    for (let i = 0; i < 7; i++) {
      const w = 60 + rnd(i * 5) * 90, span = W + w;
      const drift = reduced ? 0 : now * 0.004 * (0.5 + rnd(i * 9));
      const x = ((((rnd(i * 11) * span - cam * 0.35 + drift) % span) + span) % span) - w;
      const y = GY - 58 + rnd(i * 13) * 34;
      ctx.globalAlpha = a * (0.25 + rnd(i * 17) * 0.3);
      ctx.fillRect(x | 0, y | 0, w | 0, 3); ctx.fillRect((x + 8) | 0, (y + 3) | 0, (w - 20) | 0, 2); ctx.fillRect((x + 14) | 0, (y - 2) | 0, (w - 34) | 0, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- props
  function win(x, y, w, h, frame = "#f7f1e1", glass = "#3d5068") { R(x - 1, y - 1, w + 2, h + 2, frame); R(x, y, w, h, glass); }
  function tree(x, G, h = 20, col = "#3f9b5a", dark = "#2f7a48") {
    R(x + 4, G - h + 8, 2, h - 8, "#6b4a33");
    R(x + 1, G - h, 8, 9, col); R(x, G - h + 2, 10, 5, col); R(x + 2, G - h - 1, 6, 1, col);
    R(x + 1, G - h + 7, 8, 2, dark); R(x, G - h + 5, 2, 2, dark);
  }
  function palm(x, G, h = 32) {
    for (let i = 0; i < h; i += 3) R(x + Math.round(Math.sin(i / 9) * 1.5), G - i - 3, 2, 3, (i / 3) % 2 ? "#8a6a45" : "#7a5c3a");
    c.drawImage(SPR.palm, Math.round(x + Math.sin(h / 9) * 1.5) - 9, G - h - 8);
  }
  function lamp(x, G) { R(x, G - 26, 1, 26, "#3a3d4a"); R(x, G - 27, 5, 1, "#3a3d4a"); R(x + 4, G - 26, 2, 1, "#3a3d4a"); }
  function lampGlow(x, G, lit) {
    if (lit < 0.1) return;
    c.globalAlpha = lit; R(x + 4, G - 25, 2, 1, "#fff3c4");
    c.globalAlpha = lit * 0.12; for (let i = 0; i < 12; i++) R(x + 4 - i / 2, G - 24 + i * 2, 2 + i, 2, "#ffe9a8");
    c.globalAlpha = 1;
  }
  function hydrant(x, G) { R(x, G - 5, 3, 5, "#d9463b"); R(x - 1, G - 4, 5, 1, "#d9463b"); R(x, G - 6, 3, 1, "#b5372e"); }
  function ring(x, y) { R(x + 1, y, 4, 1, INK); R(x + 1, y + 5, 4, 1, INK); R(x, y + 1, 1, 4, INK); R(x + 5, y + 1, 1, 4, INK); }
  function bike(x, G, col) {
    ring(x, G - 6); ring(x + 9, G - 6);
    R(x + 3, G - 7, 7, 1, col); R(x + 3, G - 7, 1, 4, col); R(x + 6, G - 6, 1, 3, col); R(x + 10, G - 9, 1, 6, col);
    R(x + 2, G - 8, 3, 1, INK); R(x + 9, G - 10, 3, 1, INK);
  }
  function scooter(x, G, col) {
    R(x, G - 2, 2, 2, INK); R(x + 7, G - 2, 2, 2, INK); R(x + 1, G - 3, 7, 1, col); R(x + 7, G - 11, 1, 9, col); R(x + 6, G - 11, 3, 1, INK);
  }
  function billboard(x, G, w, h, postH, lines, { bg = "#fbfbf6", fg = "#1b1c26", accent = "#e2574c", frame = "#2d2f3b" } = {}) {
    const top = G - postH - h;
    R(x + 6, top + h, 3, postH, frame); R(x + w - 9, top + h, 3, postH, frame);
    if (postH > 8) R(x + 6, top + h + 4, w - 12, 1, frame);
    R(x - 1, top - 1, w + 2, h + 2, frame);
    R(x, top, w, h, bg);
    R(x, top + h - 3, w, 3, accent);
    const total = lines.reduce((a, l) => a + 5 * (l.s || 1) + 2, -2);
    let y = top + Math.max(1, Math.floor((h - 3 - total) / 2));
    for (const l of lines) {
      const s = l.s || 1;
      T(l.t, x + Math.floor((w - textW(l.t, s)) / 2), y, l.c || fg, s);
      y += 5 * s + 2;
    }
    for (let lx = x + 8; lx < x + w - 6; lx += 18) { R(lx, top - 4, 1, 3, frame); R(lx - 1, top - 5, 4, 1, frame); }
  }
  function victorian(x, G, w, h, wall, roof, door) {
    const trim = "#fff7ef", shade = css(mix(hex(wall), [0, 0, 0], 0.1));
    R(x, G - h, w, h, wall);
    for (let r = 0; r * 4 < w + 4; r++) R(x - 2 + r * 2, G - h - 1 - r, w + 4 - r * 4, 1, roof);
    R(x - 2, G - h, w + 4, 2, trim);
    const bayW = Math.min(20, w - 16), bx = x + w - bayW - 2;
    win(x + (w >> 1) - 2, G - h - 6, 4, 3, trim);
    win(x + 4, G - h + 6, 8, 10, trim); win(bx + 2, G - h + 6, bayW - 4, 10, trim);
    R(bx, G - 22, bayW, 22, shade); R(bx - 1, G - 23, bayW + 2, 2, trim);
    win(bx + 2, G - 19, bayW - 4, 10, trim);
    R(x + 2, G - 6, 13, 6, "#b8b2a6"); R(x + 2, G - 6, 13, 1, "#dcd7cc"); R(x + 2, G - 3, 13, 1, "#dcd7cc");
    R(x + 4, G - 22, 9, 16, trim); R(x + 5, G - 21, 7, 15, door);
  }
  function smallHouse(x, G, wall, roof) {
    R(x, G - 20, 34, 20, wall);
    for (let r = 0; r < 7; r++) R(x - 3 + r * 3, G - 21 - r, 40 - r * 6, 1, roof);
    R(x + 5, G - 13, 7, 13, "#7a4a32"); win(x + 18, G - 15, 10, 7);
  }

  // ----------------------------------------------------------------- lots
  const LOTDEF = [
    { // 0 Pre-seed: the garage
      body(ox, G) {
        R(ox, G - 2, LOT, 2, "#6fb35e");
        palm(ox + 12, G, 34);
        const hx = ox + 30, hw = 60, hh = 30;
        R(hx + 44, G - hh - 13, 5, 9, "#9a8f84");
        R(hx, G - hh, hw, hh, "#efe0bb"); R(hx, G - 3, hw, 3, "#d6c49a");
        for (let r = 0; r < 9; r++) R(hx - 4 + r * 3, G - hh - 1 - r, hw + 8 - r * 6, 1, r % 2 ? "#b9583f" : "#a84e38");
        R(hx + 7, G - 17, 10, 17, "#f7f1e1"); R(hx + 8, G - 16, 8, 16, "#3f6fb5"); R(hx + 14, G - 9, 1, 1, "#ffd98a");
        win(hx + 26, G - 21, 20, 10); R(hx + 35, G - 21, 1, 10, "#f7f1e1");
        R(hx + 20, G - 5, 5, 5, "#4f9f5c"); R(hx + 48, G - 5, 9, 5, "#4f9f5c"); R(hx + 49, G - 6, 7, 1, "#4f9f5c");
        const gx = hx + hw, gw = 54, gh = 26;
        R(gx, G - gh, gw, gh, "#e6d5ac"); R(gx - 1, G - gh - 3, gw + 3, 3, "#a84e38");
        R(gx + 5, G - 21, 44, 21, "#2b2433");
        R(gx + 5, G - 21, 44, 3, "#cfc8b6"); R(gx + 5, G - 19, 44, 1, "#aaa392");
        R(gx + 5, G - 1, 44, 1, "#4a4152");
        R(gx + 9, G - 10, 24, 2, "#9a6a45"); R(gx + 10, G - 8, 2, 8, "#6b4a33"); R(gx + 30, G - 8, 2, 8, "#6b4a33");
        R(gx + 11, G - 18, 10, 8, "#d9d2bd"); R(gx + 12, G - 17, 8, 5, "#14251c");
        c.drawImage(SPR.duck, gx + 23, G - 18);
        R(gx + 38, G - 15, 8, 15, "#3b3f4c"); R(gx + 39, G - 13, 6, 1, "#23262f"); R(gx + 39, G - 10, 6, 1, "#23262f");
        R(gx + 3, G, 48, 4, "#cfcdc6");
        R(ox + 161, G - 9, 1, 9, "#6b4a33"); R(ox + 158, G - 13, 7, 4, "#3b3f4c"); R(ox + 164, G - 15, 1, 3, "#e2574c");
      },
      glow(ox, G, lit, now) {
        const hx = ox + 30, gx = hx + 60;
        R(gx + 12, G - 17, 8, 5, "#123a22");
        R(gx + 13, G - 16, 4, 1, "#6dff9a"); R(gx + 13, G - 14, 6, 1, "#6dff9a");
        if (((now / 450) | 0) % 2) R(gx + 18, G - 16, 1, 1, "#6dff9a");
        R(gx + 44, G - 13, 1, 1, ((now / 700) | 0) % 2 ? "#6dff9a" : "#1d5a34");
        c.globalAlpha = lit; R(hx + 26, G - 21, 9, 10, "#ffd98a"); R(hx + 36, G - 21, 10, 10, "#ffd98a"); R(gx + 26, G - 18, 2, 2, "#fff3c4");
        c.globalAlpha = lit * 0.16; R(gx + 5, G - 18, 44, 18, "#ffd98a");
        c.globalAlpha = 1;
      },
    },
    { // 1 Seed: hacker house and the coffee shop everyone pitches in
      body(ox, G) {
        const vx = ox + 14, vw = 52, vh = 50;
        victorian(vx, G, vw, vh, "#9ed3c4", "#5c6b8a", "#c9503c");
        R(vx, G - 32, vw, 7, "#fffdf5"); R(vx, G - 32, vw, 1, "#d8d2c2");
        T("HACKER HOUSE", vx + 3, G - 31, "#c9503c");
        hydrant(ox + 72, G);
        const cx = ox + 84, cw = 78, ch = 38;
        R(cx, G - ch, cw, ch, "#f3e4c6"); R(cx - 1, G - ch - 2, cw + 2, 3, "#7c5a44");
        R(cx + 10, G - 35, 58, 9, "#3a2a22"); T("COFFEE + WIFI", cx + 14, G - 33, "#ffe9b8");
        R(cx + 5, G - 18, 42, 14, "#f7f1e1"); R(cx + 6, G - 17, 40, 12, "#34485c");
        for (let i = 0; i < 3; i++) {
          const px = cx + 10 + i * 13;
          R(px, G - 14, 4, 4, "#1d2733"); R(px - 1, G - 10, 6, 5, "#1d2733"); R(px + 5, G - 9, 5, 1, "#8f98a6"); R(px + 5, G - 12, 1, 3, "#8f98a6");
        }
        R(cx + 53, G - 21, 15, 21, "#f7f1e1"); R(cx + 54, G - 20, 13, 20, "#3d5870"); R(cx + 60, G - 20, 1, 20, "#f7f1e1");
        for (let i = 0; i < 19; i++) { const col = i % 2 ? "#f7f1e1" : "#e2574c"; R(cx + 1 + i * 4, G - 24, 4, 5, col); R(cx + 2 + i * 4, G - 19, 2, 1, col); }
        R(ox + 166, G - 9, 7, 9, "#2b2f38"); R(ox + 167, G - 8, 5, 6, "#3d4350"); R(ox + 168, G - 7, 3, 1, "#f4f4f0"); R(ox + 168, G - 5, 2, 1, "#f4f4f0");
      },
      glow(ox, G, lit, now) {
        const vx = ox + 14, vw = 52, vh = 50, cx = ox + 84;
        c.globalAlpha = 0.35 + lit * 0.65;
        R(vx + 4, G - vh + 6, 8, 10, ((now / 900) | 0) % 2 ? "#7fd4ff" : "#9be0ff"); R(vx + vw - 20, G - vh + 6, 16, 10, "#7fd4ff"); R(vx + vw - 20, G - 19, 16, 10, "#8fdcff");
        c.globalAlpha = 1;
        for (let i = 0; i < 3; i++) R(cx + 16 + i * 13, G - 12, 1, 3, "#cfe9ff");
        c.globalAlpha = lit;
        const bulbs = ["#ffd23f", "#ff86cf", "#56c8ec", "#8fe36b"];
        for (let i = 0; i < 13; i++) R(vx + 1 + i * 4, G - vh + 2 + (i % 2), 1, 1, bulbs[i % 4]);
        c.globalAlpha = lit * 0.5; R(cx + 6, G - 17, 40, 12, "#ffd98a");
        c.globalAlpha = 1;
      },
    },
    { // 2 Series A: a real office, a hiring banner, a sign on the roof
      body(ox, G) {
        tree(ox + 6, G, 24);
        const bx = ox + 26, bw = 104, bh = 56;
        R(bx, G - bh, bw, bh, "#a9523f");
        for (let y = G - bh + 3; y < G; y += 4) R(bx, y, bw, 1, "#8f4234");
        R(bx - 1, G - bh - 2, bw + 2, 3, "#6f3026"); R(bx, G - bh + 1, bw, 1, "#c56a55");
        for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) win(bx + 6 + col * 16, G - 50 + row * 19, 11, 10, "#2d2f3b", "#4a6078");
        R(bx + 5, G - 19, 64, 19, "#2d2f3b"); R(bx + 6, G - 18, 62, 17, "#4a6078");
        R(bx + 10, G - 16, 18, 10, "#f4f4f0");
        R(bx + 12, G - 9, 3, 1, "#e2574c"); R(bx + 15, G - 10, 3, 1, "#e2574c"); R(bx + 18, G - 12, 3, 1, "#e2574c"); R(bx + 21, G - 15, 3, 2, "#e2574c");
        R(bx + 12, G - 14, 5, 1, "#3b6fd4");
        R(bx + 32, G - 7, 32, 1, "#aeb5c0");
        for (let i = 0; i < 3; i++) { R(bx + 34 + i * 10, G - 13, 7, 5, "#1d2733"); R(bx + 37 + i * 10, G - 8, 1, 1, "#1d2733"); }
        R(bx + 75, G - 21, 22, 21, "#2d2f3b"); R(bx + 76, G - 20, 20, 20, "#4a6078"); R(bx + 85, G - 20, 2, 20, "#2d2f3b");
        R(bx + 48, G - 39, 51, 7, "#fffdf5"); T("WE'RE HIRING", bx + 50, G - 38, "#e2574c");
        billboard(bx + 21, G - bh - 2, 62, 11, 4, [{ t: "AI FOR YOUR AI" }], { accent: "#56c8ec" });
        scooter(ox + 138, G, "#8fe36b"); scooter(ox + 150, G, "#ff86cf");
        lamp(ox + 164, G);
      },
      glow(ox, G, lit) {
        const bx = ox + 26;
        for (let i = 0; i < 3; i++) R(bx + 35 + i * 10, G - 12, 5, 3, "#bfe6ff");
        c.globalAlpha = lit;
        for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) if (rnd(row * 7 + col * 3 + 2) > 0.3) R(bx + 6 + col * 16, G - 50 + row * 19, 11, 10, "#ffd98a");
        c.globalAlpha = lit * 0.45; R(bx + 6, G - 18, 62, 17, "#ffd98a");
        c.globalAlpha = 1;
        lampGlow(ox + 164, G, lit);
      },
    },
    { // 3 Series B: the city, the bridge, the fog, the billboard
      body(ox, G) {
        victorian(ox + 6, G, 34, 54, "#f4b9c6", "#6b5a78", "#3f6fb5");
        victorian(ox + 42, G, 34, 49, "#f7e3a0", "#5c6b8a", "#c9503c");
        hydrant(ox + 80, G);
        R(ox + 84, G - 22, 28, 2, "#3a3d4a"); R(ox + 85, G - 20, 1, 20, "#3a3d4a"); R(ox + 110, G - 20, 1, 20, "#3a3d4a");
        R(ox + 87, G - 6, 12, 1, "#8f98a6"); R(ox + 88, G - 5, 1, 5, "#8f98a6"); R(ox + 97, G - 5, 1, 5, "#8f98a6");
        R(ox + 101, G - 19, 9, 15, "#fbfbf6"); R(ox + 103, G - 16, 5, 4, "#8fe36b"); R(ox + 104, G - 15, 1, 1, INK); R(ox + 106, G - 15, 1, 1, INK); R(ox + 102, G - 9, 7, 1, "#e2574c"); R(ox + 102, G - 7, 5, 1, "#b3b7c4");
        billboard(ox + 112, G, 62, 30, 24, [{ t: "WE PUT A" }, { t: "CHATBOT", s: 2, c: "#3b3ac9" }, { t: "ON IT" }], { accent: "#ffc93c" });
      },
      glow(ox, G, lit) {
        c.globalAlpha = lit;
        R(ox + 10, G - 48, 8, 10, "#ffd98a"); R(ox + 24, G - 19, 12, 10, "#ffd98a"); R(ox + 46, G - 43, 8, 10, "#ffd98a"); R(ox + 60, G - 43, 12, 10, "#ffd98a");
        c.globalAlpha = lit * 0.22;
        for (let lx = ox + 120; lx < ox + 170; lx += 18) for (let i = 0; i < 8; i++) R(lx - i, G - 53 + i * 3, 2 + i * 2, 3, "#fff3c4");
        c.globalAlpha = 1;
      },
    },
    { // 4 Series C: the campus
      body(ox, G) {
        R(ox, G - 2, LOT, 2, "#6fb35e");
        const gx = ox + 8, gw = 118, gh = 38;
        for (let i = 0; i < 5; i++) { R(gx + 8 + i * 10, G - gh - 6, 8, 4, "#2c4a7c"); R(gx + 8 + i * 10, G - gh - 6, 8, 1, "#5f86c4"); }
        R(gx, G - gh, gw, gh, "#eef2f5"); R(gx - 2, G - gh - 2, gw + 4, 3, "#dfe5ea");
        R(gx + 3, G - gh + 4, gw - 6, gh - 8, "#8fd0e6"); R(gx + 3, G - 16, gw - 6, 12, "#74bcd6");
        for (let x = gx + 12; x < gx + gw - 4; x += 10) R(x, G - gh + 4, 1, gh - 8, "#eef2f5");
        R(gx + 3, G - gh + 15, gw - 6, 1, "#eef2f5");
        for (let i = 0; i < 6; i++) R(gx + 6 + i * 2, G - gh + 12 - i * 1, 1, 1, "#c9eef8");
        for (let i = 0; i < 6; i++) R(gx + 74 + i * 2, G - gh + 13 - i * 1, 1, 1, "#c9eef8");
        const cols = ["#e2574c", "#ffc93c", "#5fbf4d", "#3b6fd4"];
        for (let i = 0; i < 4; i++) R(gx + 72 + i * 9, G - gh - 8, 8, 6, cols[i]);
        R(gx + 51, G - 17, 18, 17, "#eef2f5"); R(gx + 52, G - 16, 16, 16, "#3d5870"); R(gx + 60, G - 16, 1, 16, "#eef2f5");
        R(gx + 52, G, 16, 4, "#d8d6cf");
        bike(gx + 14, G, "#ffc93c"); bike(gx + 30, G, "#e2574c"); bike(gx + 88, G, "#5fbf4d");
        tree(ox + 128, G, 26);
        R(ox + 129, G - 9, 30, 9, "#f4f6f8"); R(ox + 129, G - 9, 30, 1, "#3b6fd4"); T("BLDG 42", ox + 131, G - 6, "#3b6fd4");
        R(ox + 161, G - 4, 13, 4, "#9aa0aa");
        c.drawImage(SPR.cursor, ox + 163, G - 17);
      },
      glow(ox, G, lit) {
        const gx = ox + 8;
        c.globalAlpha = lit * 0.6;
        for (let i = 0; i < 11; i++) if (rnd(i * 5 + 1) > 0.35) R(gx + 3 + i * 10, G - 34, 9, 11, "#fff0c2");
        c.globalAlpha = lit * 0.4; R(gx + 3, G - 16, 112, 12, "#fff0c2");
        c.globalAlpha = 1;
      },
    },
    { // 5 Series D: the datacenter, and the power plant it needed
      body(ox, G, now) {
        const tx = ox + 152;
        for (let r = 0; r < 44; r++) {
          const w = Math.round(18 + Math.abs(r - 13) * 0.62);
          R(tx - w / 2, G - 44 + r, w, 1, "#cfc9c2"); R(tx + w / 2 - Math.ceil(w / 3.5), G - 44 + r, Math.ceil(w / 3.5), 1, "#b3ada6");
        }
        R(tx - 11, G - 41, 22, 2, "#d9463b");
        const dx = ox + 6, dw = 118, dh = 42;
        for (let i = 0; i < 6; i++) {
          const x = dx + 8 + i * 18;
          R(x, G - dh - 7, 12, 7, "#aab1bc"); R(x + 2, G - dh - 6, 8, 5, "#3a3f4b");
          if (((now / 130) | 0) % 2 && !reduced) R(x + 2, G - dh - 4, 8, 1, "#8f98a6"); else R(x + 5, G - dh - 6, 2, 5, "#8f98a6");
        }
        R(dx, G - dh, dw, dh, "#dfe3ea");
        for (let x = dx + 8; x < dx + dw; x += 8) R(x, G - dh, 1, dh, "#cfd4dc");
        R(dx, G - dh + 5, dw, 3, "#3b6fd4"); R(dx - 1, G - dh - 1, dw + 2, 2, "#b9c0cb");
        R(dx + 8, G - 26, 50, 26, "#161821");
        for (let i = 0; i < 6; i++) R(dx + 11 + i * 8, G - 23, 6, 22, "#2b303c");
        R(dx + 66, G - 31, 45, 9, INK);
        R(dx + 70, G - 16, 9, 16, "#8f98a6"); R(dx + 80, G - 10, 1, 2, "#d9463b");
        R(dx + 88, G - 18, 22, 18, "#c4cad3"); R(dx + 90, G - 20, 18, 2, "#c4cad3"); R(dx + 88, G - 12, 22, 2, "#3b6fd4"); T("H2O", dx + 94, G - 9, "#3b6fd4");
        R(dx + 84, G - 6, 4, 1, "#8f98a6"); R(dx + 84, G - 6, 1, 6, "#8f98a6");
        for (let i = 0; i < 4; i++) { R(dx + 12 + i * 14, G - 5, 2, 5, "#ffc93c"); R(dx + 12 + i * 14, G - 3, 2, 1, INK); }
      },
      glow(ox, G, lit, now) {
        const dx = ox + 6, tx = ox + 152;
        const tick = reduced ? 0 : (now / 260) | 0;
        for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) {
          const r = rnd(i * 31 + j * 7 + ((tick + i * 3 + j) % 9) * 13);
          if (r > 0.42) R(dx + 12 + i * 8 + (j % 2) * 3, G - 22 + j * 2, 1, 1, r > 0.93 ? "#ffb347" : r > 0.8 ? "#56c8ec" : "#6dff9a");
        }
        T("GPU FARM 7", dx + 69, G - 29, "#6dff9a");
        c.globalAlpha = 0.1 + lit * 0.12; R(dx + 8, G - 26, 50, 26, "#56c8ec");
        c.globalAlpha = 0.85;
        for (let i = 0; i < 4; i++) {
          const ph = reduced ? i / 4 : (now / 2600 + i / 4) % 1;
          const y = G - 46 - ph * 26, w = 8 + ph * 12;
          c.globalAlpha = 0.8 * (1 - ph);
          R(tx - w / 2 + Math.sin(ph * 5 + i) * 3, y, w, 3, "#f7f8fa"); R(tx - w / 2 + 2 + Math.sin(ph * 5 + i) * 3, y - 2, w - 4, 2, "#f7f8fa");
        }
        c.globalAlpha = 1;
      },
    },
    { // 6 IPO: the exchange
      body(ox, G, now) {
        const ex = ox + 20, ew = 112, eh = 46;
        R(ex + (ew >> 1), G - eh - 23, 1, 12, "#8f98a6");
        const wave = reduced ? 0 : ((now / 300) | 0) % 2;
        R(ex + (ew >> 1) + 1, G - eh - 23 + wave, 8, 5, "#ffc93c"); R(ex + (ew >> 1) + 1, G - eh - 21 + wave, 8, 1, "#e2574c");
        R(ex - 6, G - 3, ew + 12, 3, "#d9d2bf"); R(ex - 3, G - 6, ew + 6, 3, "#e3dcc9");
        R(ex, G - eh, ew, eh - 6, "#efe8d6");
        R(ex + 3, G - eh + 9, ew - 6, eh - 15, "#8d8674");
        R(ex + 50, G - 24, 12, 18, "#3a2a22");
        for (let i = 0; i < 6; i++) {
          const x = ex + 6 + i * 19;
          R(x, G - eh + 9, 6, eh - 15, "#f7f2e4"); R(x + 4, G - eh + 9, 2, eh - 15, "#d6ceb9");
          R(x - 1, G - eh + 9, 8, 2, "#d6ceb9"); R(x - 1, G - 8, 8, 2, "#d6ceb9");
        }
        R(ex - 2, G - eh, ew + 4, 9, "#e3dcc9"); R(ex + 2, G - eh + 1, ew - 4, 7, INK);
        for (let r = 0; r < 12; r++) R(ex - 2 + r * 5, G - eh - 1 - r, ew + 4 - r * 10, 1, r === 0 ? "#cfc7b2" : "#e9e2cf");
        c.drawImage(SPR.bell, ex + (ew >> 1) - 4, G - eh - 10);
        R(ex + 36, G - eh + 12, 40, 15, "#c0392b"); R(ex + 36, G - eh + 27, 14, 2, "#c0392b"); R(ex + 62, G - eh + 27, 14, 2, "#c0392b");
        T("IPO", ex + 45, G - eh + 14, "#ffd98a", 2);
        R(ex + 48, G - 6, 16, 10, "#c0392b");
        R(ex + 44, G - 11, 1, 5, "#ffc93c"); R(ex + 67, G - 11, 1, 5, "#ffc93c"); R(ex + 43, G - 12, 3, 1, "#ffc93c"); R(ex + 66, G - 12, 3, 1, "#ffc93c");
        palm(ox + 150, G, 30); palm(ox + 164, G, 24);
      },
      glow(ox, G, lit, now) {
        const ex = ox + 20, ew = 112, eh = 46;
        const tape = "SLOP +420%   GPU +88%   AGI -3%   MOAT 0%   VIBES +12%   ";
        const tw = tape.length * 4;
        c.save(); c.beginPath(); c.rect(ex + 2, G - eh + 1, ew - 4, 7); c.clip();
        const off = reduced ? 0 : ((now / 70) | 0) % tw;
        T(tape + tape + tape, ex + 4 - off, G - eh + 2, "#ffb347");
        c.restore();
        c.globalAlpha = lit * 0.5; R(ex + 50, G - 24, 12, 18, "#ffd98a");
        c.globalAlpha = lit * 0.55;
        for (let i = 0; i < 6; i++) R(ex + 6 + i * 19, G - eh + 11, 4, eh - 19, "#ffe9b8");
        c.globalAlpha = lit * 0.8; R(ex + 36, G - eh + 12, 40, 15, "#d8443a");
        c.globalAlpha = lit; T("IPO", ex + 45, G - eh + 14, "#fff1b8", 2);
        c.globalAlpha = 1;
      },
    },
  ];

  function filler(ox, G, i) {
    R(ox, G - 2, LOT, 2, "#6fb35e");
    const walls = ["#efe0bb", "#cfe0ea", "#f2c9b0", "#dfe7c4"], roofs = ["#a84e38", "#5c6b8a", "#7c5a44"];
    for (let k = 0; k < 3; k++) {
      const s = i * 17 + k * 5;
      const x = ox + 8 + k * 58 + ((rnd(s) * 10) | 0);
      if (rnd(s + 9) > 0.45) smallHouse(x, G, walls[(rnd(s + 1) * 4) | 0], roofs[(rnd(s + 2) * 3) | 0]);
      else { tree(x + 4, G, 20 + ((rnd(s + 3) * 8) | 0)); if (rnd(s + 4) > 0.5) palm(x + 26, G, 26 + ((rnd(s + 5) * 10) | 0)); else tree(x + 22, G, 18); }
    }
  }

  // ------------------------------------------------------------- vehicles
  function taxi(x, y, now) {
    R(x + 2, y - 9, 22, 6, "#f4f5f7"); R(x + 6, y - 13, 13, 4, "#f4f5f7");
    R(x + 7, y - 12, 5, 3, "#2b3340"); R(x + 13, y - 12, 5, 3, "#2b3340");
    R(x + 2, y - 4, 22, 1, "#c8ccd3"); R(x + 1, y - 8, 1, 4, "#f4f5f7"); R(x + 24, y - 8, 1, 4, "#f4f5f7");
    R(x + 5, y - 4, 4, 4, INK); R(x + 17, y - 4, 4, 4, INK); R(x + 6, y - 3, 2, 2, "#7b808c"); R(x + 18, y - 3, 2, 2, "#7b808c");
    R(x + 11, y - 15, 4, 2, "#3a3f4b"); R(x + 12, y - 16, 2, 1, "#3a3f4b");
    R(x + 11 + (reduced ? 0 : ((now / 150) | 0) % 4), y - 15, 1, 1, "#5ad1ff");
    R(x + 24, y - 7, 1, 2, "#ffe9a8"); R(x + 1, y - 7, 1, 2, "#e2574c"); R(x + 3, y - 10, 2, 1, "#3a3f4b");
  }
  function bus(x, y) {
    R(x + 1, y - 15, 44, 12, "#f4f5f7"); R(x, y - 13, 1, 9, "#f4f5f7"); R(x + 45, y - 12, 1, 8, "#f4f5f7");
    R(x + 3, y - 13, 40, 5, "#232a36"); for (let i = 0; i < 4; i++) R(x + 11 + i * 9, y - 13, 1, 5, "#f4f5f7");
    R(x + 1, y - 6, 44, 1, "#56c8ec"); R(x + 1, y - 4, 44, 1, "#c8ccd3");
    R(x + 7, y - 4, 5, 4, INK); R(x + 33, y - 4, 5, 4, INK); R(x + 8, y - 3, 3, 2, "#7b808c"); R(x + 34, y - 3, 3, 2, "#7b808c");
    R(x + 45, y - 7, 1, 2, "#ffe9a8");
  }
  function bot(x, y, now) {
    R(x, y - 7, 9, 5, "#f4f5f7"); R(x, y - 7, 9, 1, "#d2d6dc"); R(x, y - 2, 2, 2, INK); R(x + 4, y - 2, 2, 2, INK); R(x + 7, y - 2, 2, 2, INK);
    R(x + 7, y - 13, 1, 6, "#8f98a6"); R(x + 4, y - 13, 3, 2, "#ff8a3c");
    R(x + 1, y - 5, 1, 1, ((now / 600) | 0) % 5 ? "#56c8ec" : "#f4f5f7"); R(x + 3, y - 5, 1, 1, "#56c8ec");
  }
  function drawCar(car, now) {
    const w = car.kind === "bus" ? 46 : car.kind === "taxi" ? 26 : 9;
    const x = Math.round(car.x - cam + W / 2);
    if (x < -w - 4 || x > W + 4) return;
    const y = car.kind === "bot" ? GY + 4 : car.dir > 0 ? GY + 22 : GY + 13;
    const fn = car.kind === "bus" ? bus : car.kind === "taxi" ? taxi : bot;
    if (car.dir > 0) fn(x, y, now);
    else { c.save(); c.translate(x * 2 + w, 0); c.scale(-1, 1); fn(x, y, now); c.restore(); }
  }

  // --------------------------------------------------------------- mascot
  function drawMascot(now, moving) {
    const mx = Math.round(W / 2 - 46), base = GY + 3;
    let lift = 0;
    const u = (now - hopT0) / 380;
    if (u >= 0 && u < hopN) lift = Math.round(Math.abs(Math.sin(u * Math.PI)) * 11);
    const bob = reduced ? 0 : moving ? ((now / 130) | 0) % 2 : ((now / 620) | 0) % 2;
    const y = base - 12 - lift + (lift ? 0 : bob);
    c.globalAlpha = 0.25; R(mx + 2 + (lift > 5 ? 2 : 0), base, 12 - (lift > 5 ? 4 : 0), 1, "#000"); c.globalAlpha = 1;
    c.drawImage(SPR.blob, 0, 0, 16, 11, mx, y, 16, 11);
    c.drawImage(SPR.blob, 0, 11, 16, 1, mx, lift ? y + 11 : base - 1, 16, 1);
    // the wardrobe grows with the cap table
    const st = target;
    if (st === 1 || st === 2) { R(mx + 3, y - 1, 10, 1, INK); R(mx + 1, y + 2, 2, 4, INK); R(mx + 13, y + 2, 2, 4, INK); }
    if (st === 2) { R(mx + 7, y + 8, 1, 1, "#3b6fd4"); R(mx + 6, y + 9, 3, 2, "#ffffff"); }
    if (st === 3 || st === 4) { R(mx + 2, y + 8, 5, 3, "#2b3a67"); R(mx + 9, y + 8, 5, 3, "#2b3a67"); R(mx + 2, y + 8, 5, 1, "#3d4f86"); R(mx + 9, y + 8, 5, 1, "#3d4f86"); }
    if (st === 5) { R(mx + 1, y + 9, 14, 2, INK); R(mx + 5, y + 8, 6, 1, INK); }
    if (st >= 6) { R(mx + 4, y - 5, 8, 5, INK); R(mx + 2, y, 12, 1, INK); R(mx + 4, y - 2, 8, 1, "#ffc93c"); R(mx + 6, y + 9, 1, 2, "#e2574c"); R(mx + 9, y + 9, 1, 2, "#e2574c"); R(mx + 7, y + 9, 2, 1, "#e2574c"); }
    return { x: mx + 8, y };
  }

  // ------------------------------------------------------------ particles
  function burst(x, y, n, colors, speed = 60, g = 120, life = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, g, life, max: life, col: colors[(Math.random() * colors.length) | 0] });
    }
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  // ------------------------------------------------------------ the frame
  function draw(now) {
    if (!W) return;
    const t = cam / LOT - 0.5;
    const lit = rampN(LIT, t);
    const moving = now - camT0 < PAN_MS;

    c = ctx;
    drawSky(t);
    drawCelestial(t, now);
    drawClouds(t, now);
    drawHills(t);
    drawBridge(t);
    drawSkyline(t, lit);
    drawFog(t, now);

    // near layer: pavement and lots, tinted by time of day, then lights on top
    c = nctx;
    c.clearRect(0, 0, W, H);
    R(0, GY, W, 4, "#bdbab1"); R(0, GY + 4, W, 1, "#8d8a83");
    const left = cam - W / 2;
    for (let wx = Math.floor(left / 16) * 16; wx < left + W; wx += 16) R(wx - left, GY, 1, 4, "#a5a299");
    const i0 = Math.floor(left / LOT), i1 = Math.floor((left + W) / LOT);
    for (let i = i0; i <= i1; i++) {
      const ox = Math.round(i * LOT - left);
      if (i >= 0 && i < LOTS) LOTDEF[i].body(ox, GY, now); else filler(ox, GY, i);
    }
    const tintA = rampN(TINT_A, t);
    if (tintA > 0.01) {
      const tc = ramp(TINT, t);
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = `rgba(${tc[0] | 0},${tc[1] | 0},${tc[2] | 0},${tintA})`;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = "source-over";
    }
    for (let i = Math.max(0, i0); i <= Math.min(LOTS - 1, i1); i++) LOTDEF[i].glow(Math.round(i * LOT - left), GY, lit, now);
    ctx.drawImage(near, 0, 0);

    c = ctx;
    R(0, GY + 5, W, ROAD - 5, ROAD_COL);
    for (let wx = Math.floor(left / 22) * 22; wx < left + W; wx += 22) R(wx - left, GY + 14, 10, 2, "#ffc93c");
    for (const car of cars) if (car.dir < 0 && car.kind !== "bot") drawCar(car, now);
    for (const car of cars) if (car.kind === "bot") drawCar(car, now);
    const m = drawMascot(now, moving);
    for (const car of cars) if (car.dir > 0) drawCar(car, now);
    for (const p of parts) { c.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1); R(p.x, p.y, 2, 2, p.col); }
    c.globalAlpha = 1;
    return m;
  }

  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    if (now - last < 30) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const u = clamp((now - camT0) / PAN_MS, 0, 1);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    cam = camFrom + (camTo - camFrom) * e;
    for (const car of cars) {
      car.x += car.v * car.dir * dt;
      const rel = car.x - cam;
      if (car.dir > 0 && rel > W / 2 + 90) car.x = cam - W / 2 - 90 - Math.random() * 260;
      if (car.dir < 0 && rel < -W / 2 - 90) car.x = cam + W / 2 + 90 + Math.random() * 260;
    }
    // the exchange gets fireworks and ticker tape
    if (Math.abs(cam / LOT - 0.5 - 6) < 0.4 && now > fwNext) {
      fwNext = now + 700 + Math.random() * 900;
      const pal = [["#ffc93c", "#fff1b8"], ["#ff86cf", "#ffd0ec"], ["#56c8ec", "#c9eef8"], ["#8fe36b", "#dcffc8"]][(Math.random() * 4) | 0];
      burst(W * (0.15 + Math.random() * 0.7), GY * (0.12 + Math.random() * 0.3), 26, pal, 46, 26, 1.2);
    }
    stepParts(dt);
    draw(now);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  resize();
  if (!reduced) requestAnimationFrame(frame);

  return {
    resize,
    // Pan to a lot. `instant` skips the walk.
    goTo(i, instant = false) {
      target = clamp(i, 0, LOTS - 1);
      const dest = target * LOT + LOT / 2;
      if (instant || reduced) { cam = camFrom = camTo = dest; camT0 = -1e9; if (reduced) draw(performance.now()); return; }
      camFrom = cam; camTo = dest; camT0 = performance.now();
    },
    // The mascot celebrates. level is the tier index, 0 for a miss.
    cheer(level, colors) {
      if (reduced || !level) return;
      hopT0 = performance.now();
      hopN = level >= 6 ? 3 : level >= 4 ? 2 : 1;
      burst(W / 2 - 38, GY - 10, 6 + level * 6, colors, 40 + level * 8, 150, 0.7 + level * 0.08);
    },
    destroy() { alive = false; ro.disconnect(); },
  };
}
