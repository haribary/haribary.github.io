/**
 * How one colour scheme takes over from another: not along a line, and not as
 * a fade, but as spots. Blots start at scattered places and times, grow with
 * ragged edges, and run together until the screen is covered.
 *
 * `spotsAt` answers one question: at this place on the screen, for this much
 * progress (0..1), how far has the new scheme arrived (0..1)? It is a pure
 * function, so scrolling back un-grows the same blots. The same function is
 * written twice, once in GLSL for everything the canvas draws and once in
 * TypeScript for the few DOM pieces that must change colour with it; both use
 * the same integer hash, so they agree to within rounding.
 *
 *   uv      place on the screen, x and y in 0..1, y = 0 at the bottom
 *   aspect  viewport width / height, so the blots stay round
 *   t       progress, 0 = none of it, 1 = all of it
 *   seed    which pattern (a whole number); each transition has its own
 */

/** Large blots across the height of the viewport. */
const CELLS = 4.6
/** Small spots that run ahead of a blot's edge, as a multiple of that. */
const FINE = 3.2
/** Half the width of a blot's soft edge, in cells. */
const FEATHER = 0.02
/** How far the ragged edge wanders from a circle, in cells. */
const WARP = 0.55
/** A blot starts somewhere in the first part of the transition and takes this long to grow. */
const BIRTH = 0.66
const GROW = 0.34
/** The radius a blot grows to, in cells: smallest and largest. */
const SMALL = 0.4
const LARGE = 0.85
/** In the last part every blot swells by this much more, which closes the gaps between them. */
const CLOSE_FROM = 0.6
const CLOSE = 1.05
/** Progress 0..1 is played on this stretch of the blots' own clock. */
const LEAD = 0.08
const SPAN = 0.82
/** How far ahead of a blot's edge its small spots appear, in cells, and how large they get (fine cells). */
const AHEAD = 0.42
const DOT = 0.46

export const SPOTS_GLSL = /* glsl */ `
  uint spHash(ivec2 c, uint k) {
    uint h = uint(c.x + 4096) * 0x9E3779B1u ^ uint(c.y + 4096) * 0x85EBCA77u ^ k * 0xC2B2AE3Du;
    h ^= h >> 15; h *= 0x2C1B3C6Du; h ^= h >> 12; h *= 0x297A2D39u; h ^= h >> 15;
    return h;
  }
  float spRand(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }
  float spNoise(vec2 p, uint k) {
    vec2 i = floor(p);
    vec2 f = p - i;
    f = f * f * (3.0 - 2.0 * f);
    ivec2 c = ivec2(i);
    float a = spRand(spHash(c, k));
    float b = spRand(spHash(c + ivec2(1, 0), k));
    float d = spRand(spHash(c + ivec2(0, 1), k));
    float e = spRand(spHash(c + ivec2(1, 1), k));
    return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
  }
  // Signed distance (in cells, negative inside) to the nearest large blot.
  float spBlots(vec2 q, float t, uint k) {
    ivec2 c = ivec2(floor(q));
    float swell = ${CLOSE.toFixed(4)} * smoothstep(${CLOSE_FROM.toFixed(4)}, 1.0, t);
    float best = 1e3;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec2 cell = c + ivec2(x, y);
        uint h = spHash(cell, k);
        vec2 at = vec2(cell) + vec2(spRand(h), spRand(h * 0x9E3779B1u + 1u));
        float born = ${BIRTH.toFixed(4)} * spRand(h * 0x85EBCA77u + 2u);
        float size = mix(${SMALL.toFixed(4)}, ${LARGE.toFixed(4)}, spRand(h * 0xC2B2AE3Du + 3u));
        // Fast at first, then slowing, the way ink soaks out.
        float g = 1.0 - clamp((t - born) / ${GROW.toFixed(4)}, 0.0, 1.0);
        g = 1.0 - g * g;
        best = min(best, distance(q, at) - (mix(-0.6, size, g) + swell * g));
      }
    }
    return best;
  }
  // The same for the small spots, each grown by "amount" (0..1).
  float spDots(vec2 q, float amount, uint k) {
    ivec2 c = ivec2(floor(q));
    float best = 1e3;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec2 cell = c + ivec2(x, y);
        uint h = spHash(cell, k);
        vec2 at = vec2(cell) + vec2(spRand(h), spRand(h * 0x9E3779B1u + 1u));
        float size = ${DOT.toFixed(4)} * spRand(h * 0xC2B2AE3Du + 3u);
        best = min(best, distance(q, at) - mix(-0.2, size, amount));
      }
    }
    return best;
  }
  float spotsAt(vec2 uv, float aspect, float t, float seed) {
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    uint k = uint(seed) * 7919u;
    vec2 p = vec2(uv.x * aspect, uv.y) * ${CELLS.toFixed(4)};
    vec2 w = vec2(spNoise(p * 1.9, k + 11u), spNoise(p * 1.9, k + 12u)) - 0.5;
    w += 0.35 * (vec2(spNoise(p * 5.3, k + 13u), spNoise(p * 5.3, k + 14u)) - 0.5);
    vec2 q = p + ${WARP.toFixed(4)} * w;
    // The blots' own clock: the first is already showing as progress leaves 0,
    // and the last gap has closed just before it reaches 1.
    float d = spBlots(q, ${LEAD.toFixed(4)} + ${SPAN.toFixed(4)} * t, k + 1u);
    // Small spots come up just ahead of a blot's edge and are then swallowed by it.
    float ahead = 1.0 - smoothstep(0.0, ${AHEAD.toFixed(4)}, d);
    d = min(d, spDots(q * ${FINE.toFixed(4)}, ahead, k + 2u) / ${FINE.toFixed(4)});
    float cover = 1.0 - smoothstep(${(-FEATHER).toFixed(4)}, ${FEATHER.toFixed(4)}, d);
    return max(cover, smoothstep(0.97, 1.0, t));
  }
`

const imul = Math.imul

function hash(cx: number, cy: number, k: number) {
  let h = (imul(cx + 4096, 0x9e3779b1) ^ imul(cy + 4096, 0x85ebca77) ^ imul(k, 0xc2b2ae3d)) >>> 0
  h ^= h >>> 15
  h = imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  h = imul(h, 0x297a2d39) >>> 0
  h ^= h >>> 15
  return h >>> 0
}

const rand = (h: number) => (h >>> 8) / 16777216

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

function noise(px: number, py: number, k: number) {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = ease(px - ix)
  const fy = ease(py - iy)
  const a = rand(hash(ix, iy, k))
  const b = rand(hash(ix + 1, iy, k))
  const d = rand(hash(ix, iy + 1, k))
  const e = rand(hash(ix + 1, iy + 1, k))
  return a + (b - a) * fx + (d + (e - d) * fx - (a + (b - a) * fx)) * fy
}

const step = (a: number, b: number, x: number) => ease((x - a) / (b - a))

function blots(qx: number, qy: number, t: number, k: number) {
  const cx = Math.floor(qx)
  const cy = Math.floor(qy)
  const swell = CLOSE * step(CLOSE_FROM, 1, t)
  let best = 1e3
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const h = hash(cx + x, cy + y, k)
      const ax = cx + x + rand(h)
      const ay = cy + y + rand((imul(h, 0x9e3779b1) + 1) >>> 0)
      const born = BIRTH * rand((imul(h, 0x85ebca77) + 2) >>> 0)
      const size = SMALL + (LARGE - SMALL) * rand((imul(h, 0xc2b2ae3d) + 3) >>> 0)
      let g = 1 - Math.min(1, Math.max(0, (t - born) / GROW))
      g = 1 - g * g
      best = Math.min(best, Math.hypot(qx - ax, qy - ay) - (-0.6 + (size + 0.6) * g + swell * g))
    }
  }
  return best
}

function dots(qx: number, qy: number, amount: number, k: number) {
  const cx = Math.floor(qx)
  const cy = Math.floor(qy)
  let best = 1e3
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const h = hash(cx + x, cy + y, k)
      const ax = cx + x + rand(h)
      const ay = cy + y + rand((imul(h, 0x9e3779b1) + 1) >>> 0)
      const size = DOT * rand((imul(h, 0xc2b2ae3d) + 3) >>> 0)
      best = Math.min(best, Math.hypot(qx - ax, qy - ay) - (-0.2 + (size + 0.2) * amount))
    }
  }
  return best
}

/** The TypeScript twin of the shader's `spotsAt`. `x`, `y` in 0..1, y = 0 at the bottom. */
export function spotsAt(x: number, y: number, aspect: number, t: number, seed: number) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const k = imul(Math.trunc(seed), 7919) >>> 0
  const px = x * aspect * CELLS
  const py = y * CELLS
  let wx = noise(px * 1.9, py * 1.9, k + 11) - 0.5
  let wy = noise(px * 1.9, py * 1.9, k + 12) - 0.5
  wx += 0.35 * (noise(px * 5.3, py * 5.3, k + 13) - 0.5)
  wy += 0.35 * (noise(px * 5.3, py * 5.3, k + 14) - 0.5)
  const qx = px + WARP * wx
  const qy = py + WARP * wy
  let d = blots(qx, qy, LEAD + SPAN * t, k + 1)
  const ahead = 1 - step(0, AHEAD, d)
  d = Math.min(d, dots(qx * FINE, qy * FINE, ahead, k + 2) / FINE)
  return Math.max(1 - step(-FEATHER, FEATHER, d), step(0.97, 1, t))
}
