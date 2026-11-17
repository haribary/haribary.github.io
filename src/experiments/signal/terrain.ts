import { BufferAttribute, BufferGeometry } from "three"

import { blur1d, clamp, pchip, sample1d, smooth } from "./math"

/**
 * The landscape. `terrain.bin` is 353 time frames by 128 frequency bands of
 * energy; here it becomes a heightfield in world units:
 *
 *   +X  time, the direction of flight
 *   +Y  up
 *   +Z  toward low frequencies (the bottom of the figure seen from above)
 *
 * Everything the scene draws is derived once, on load: one polyline per time
 * frame, a depth-only surface that hides the lines behind each hill, the
 * camera's lane through the hills, and the pitch contour that floats above it.
 */

export const FRAMES = 353
export const BINS = 128
/** World distance between two time frames, and between two frequency bands. */
export const DX = 0.2
export const DZ = 0.13
export const HMAX = 3.3
export const LENGTH = (FRAMES - 1) * DX
export const HALF_W = ((BINS - 1) * DZ) / 2

/** Each line is resampled across frequency so it stays a curve up close. */
const UPS = 3
const NZ = (BINS - 1) * UPS + 1
/** Energy to height: above 1 flattens the quiet mass and keeps the peaks. */
const GAMMA = 2.2
/** Flat ground drawn before the first frame and after the last one. */
const GROUND_BEFORE = 260
const GROUND_AFTER = 260
/** Where each line continues, flat, beyond the two edges of the data. */
const SKIRT = [0.02, 1.2, 3.5, 8, 16, 30, 52]
const MAX_LEVEL = 8

/** Height of the pitch line above the lane floor, and how far pitch lifts it. */
export const ROPE_BASE = 0.1
export const ROPE_AMP = 0.42

export const frameX = (f: number) => f * DX
export const binZ = (b: number) => HALF_W - b * DZ

/**
 * What the page needs from `terrain.json`, all of it written by
 * tools/voice/make_terrain.py for whichever recording is in use.
 */
export type TerrainMeta = {
  /** Pitch in Hz per frame, 0 where unvoiced. */
  f0: readonly number[]
  /**
   * The camera's lane as (frame, band) knots: the lowest corridor through both
   * ranges that is smooth enough to fly. The voiced mass of the sentence is
   * to the right of the flight, the hiss of its consonants to the left.
   */
  lane: readonly (readonly [number, number])[]
  /** Frames where speech starts, the pause starts, the pause ends, speech ends. */
  layout: readonly [number, number, number, number]
  /** The speaker's pitch range in Hz: the bottom and top of the pitch line. */
  f0Range: readonly [number, number]
}

export type Poly = {
  /** n points, xyz. */
  pts: Float32Array
  /** n triples: stroke weight in figure mode, prominence 0..1, dHeight/dX. */
  info: Float32Array
  /** Lines with a higher level survive longer as the lines crowd together. */
  level: number
}

export type Terrain = {
  lines: BufferGeometry
  occluder: BufferGeometry
  rope: BufferGeometry
  /** Lane centre (world z) at world x. */
  lane: (x: number) => number
  /** Smoothed curvature of the lane, for banking. */
  bend: (x: number) => number
  /** Smooth floor of the lane: never below the terrain inside the corridor. */
  floor: (x: number) => number
  /** Pitch contour 0..1, gaps bridged and smoothed. */
  pitch: (x: number) => number
  dispose: () => void
}

/**
 * Turns polylines into one mesh of screen-space ribbons. Every point becomes
 * two vertices that the vertex shader pushes apart along the line's normal on
 * screen, so a line keeps a constant pixel width at any distance.
 */
export function buildFatLines(polys: Poly[]) {
  let points = 0
  let segments = 0
  for (const p of polys) {
    const n = p.pts.length / 3
    points += n
    segments += n - 1
  }
  const count = points * 2
  const position = new Float32Array(count * 3)
  const prev = new Float32Array(count * 3)
  const next = new Float32Array(count * 3)
  const side = new Float32Array(count)
  const info = new Float32Array(count * 4)
  const index = new Uint32Array(segments * 6)

  let v = 0
  let w = 0
  for (const { pts, info: inf, level } of polys) {
    const n = pts.length / 3
    for (let i = 0; i < n; i++) {
      const a = i * 3
      const b = i > 0 ? a - 3 : a + 3
      const c = i < n - 1 ? a + 3 : a - 3
      // Reflect the single neighbour at either end so the direction is defined.
      const sb = i > 0 ? 1 : -1
      const sc = i < n - 1 ? 1 : -1
      for (let s = 0; s < 2; s++) {
        const o = v * 3
        for (let k = 0; k < 3; k++) {
          const p = pts[a + k]
          position[o + k] = p
          prev[o + k] = p + sb * (pts[b + k] - p)
          next[o + k] = p + sc * (pts[c + k] - p)
        }
        side[v] = s === 0 ? -1 : 1
        info[v * 4] = level
        info[v * 4 + 1] = inf[a]
        info[v * 4 + 2] = inf[a + 1]
        info[v * 4 + 3] = inf[a + 2]
        v++
      }
      if (i < n - 1) {
        const q = v - 2
        index[w++] = q
        index[w++] = q + 1
        index[w++] = q + 2
        index[w++] = q + 1
        index[w++] = q + 3
        index[w++] = q + 2
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new BufferAttribute(position, 3))
  geo.setAttribute("aPrev", new BufferAttribute(prev, 3))
  geo.setAttribute("aNext", new BufferAttribute(next, 3))
  geo.setAttribute("aSide", new BufferAttribute(side, 1))
  geo.setAttribute("aInfo", new BufferAttribute(info, 4))
  geo.setIndex(new BufferAttribute(index, 1))
  return geo
}

function trailingZeros(i: number) {
  let n = Math.abs(i)
  if (n === 0) return MAX_LEVEL
  let z = 0
  while ((n & 1) === 0 && z < MAX_LEVEL) {
    n >>= 1
    z++
  }
  return z
}

export function buildTerrain(bytes: Uint8Array, meta: TerrainMeta): Terrain {
  const { f0, layout, f0Range } = meta
  // --- Heights at the data's own resolution --------------------------------
  const energy = new Float32Array(FRAMES * BINS)
  const height = new Float32Array(FRAMES * BINS)
  for (let f = 0; f < FRAMES; f++) {
    for (let b = 0; b < BINS; b++) {
      const e = bytes[f * BINS + b] / 255
      // Ease the heights to zero at both edges so the land has no cliff.
      const taper = smooth(-0.5, 7, b) * smooth(-0.5, 6, BINS - 1 - b)
      // The second range stands a little taller than the first.
      const gain = 1 + 0.22 * smooth(layout[1], layout[2], f)
      energy[f * BINS + b] = e
      height[f * BINS + b] = HMAX * Math.pow(e, GAMMA) * taper * gain
    }
  }

  // --- Resample every frame across frequency (Catmull-Rom) -----------------
  const hi = new Float32Array(FRAMES * NZ)
  const fig = new Float32Array(FRAMES * NZ)
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  for (let f = 0; f < FRAMES; f++) {
    const row = f * BINS
    for (let j = 0; j < NZ; j++) {
      const b = Math.min(BINS - 2, Math.floor(j / UPS))
      const t = j / UPS - b
      const i0 = row + Math.max(0, b - 1)
      const i1 = row + b
      const i2 = row + b + 1
      const i3 = row + Math.min(BINS - 1, b + 2)
      hi[f * NZ + j] = Math.max(0, cr(height[i0], height[i1], height[i2], height[i3], t))
      const e = clamp(cr(energy[i0], energy[i1], energy[i2], energy[i3], t))
      fig[f * NZ + j] = Math.pow(e, 1.2)
    }
  }

  // How fast the land rises from one frame to the next, smoothed: the lines
  // use it to judge how crowded they are, and that judgement must not flicker
  // along a line.
  const slope = new Float32Array(FRAMES * NZ)
  for (let f = 0; f < FRAMES; f++) {
    const before = Math.max(0, f - 1) * NZ
    const after = Math.min(FRAMES - 1, f + 1) * NZ
    for (let j = 0; j < NZ; j++) slope[f * NZ + j] = (hi[after + j] - hi[before + j]) / (2 * DX)
    blur1d(slope.subarray(f * NZ, (f + 1) * NZ), 7)
  }
  const column = new Float32Array(FRAMES)
  for (let j = 0; j < NZ; j++) {
    for (let f = 0; f < FRAMES; f++) column[f] = slope[f * NZ + j]
    blur1d(column, 1.5)
    for (let f = 0; f < FRAMES; f++) slope[f * NZ + j] = column[f]
  }

  // --- One polyline per time frame, plus the flat ground around the data ---
  const polys: Poly[] = []
  const rowPoints = NZ + SKIRT.length * 2
  for (let f = 0; f < FRAMES; f++) {
    const pts = new Float32Array(rowPoints * 3)
    const info = new Float32Array(rowPoints * 3)
    const x = frameX(f)
    let p = 0
    for (let k = SKIRT.length - 1; k >= 0; k--) {
      pts[p * 3] = x
      pts[p * 3 + 2] = HALF_W + SKIRT[k]
      p++
    }
    for (let j = 0; j < NZ; j++) {
      const h = hi[f * NZ + j]
      pts[p * 3] = x
      pts[p * 3 + 1] = h
      pts[p * 3 + 2] = HALF_W - (j * DZ) / UPS
      info[p * 3] = fig[f * NZ + j]
      info[p * 3 + 1] = smooth(0.01, 0.28, h / HMAX)
      info[p * 3 + 2] = slope[f * NZ + j]
      p++
    }
    for (let k = 0; k < SKIRT.length; k++) {
      pts[p * 3] = x
      pts[p * 3 + 2] = -HALF_W - SKIRT[k]
      p++
    }
    polys.push({ pts, info, level: trailingZeros(f) })
  }

  const groundZ: number[] = []
  for (let k = SKIRT.length - 1; k >= 0; k--) groundZ.push(HALF_W + SKIRT[k])
  for (let k = 0; k <= 14; k++) groundZ.push(HALF_W - (k / 14) * 2 * HALF_W)
  for (let k = 0; k < SKIRT.length; k++) groundZ.push(-HALF_W - SKIRT[k])
  const groundRow = (f: number) => {
    const pts = new Float32Array(groundZ.length * 3)
    for (let k = 0; k < groundZ.length; k++) {
      pts[k * 3] = frameX(f)
      pts[k * 3 + 2] = groundZ[k]
    }
    polys.push({ pts, info: new Float32Array(groundZ.length * 3), level: trailingZeros(f) })
  }
  for (let f = -GROUND_BEFORE; f < 0; f++) groundRow(f)
  for (let f = FRAMES; f < FRAMES + GROUND_AFTER; f++) groundRow(f)

  const lines = buildFatLines(polys)

  // --- Depth-only surface under the lines ----------------------------------
  const surface = new Float32Array(FRAMES * NZ * 3)
  for (let f = 0; f < FRAMES; f++) {
    for (let j = 0; j < NZ; j++) {
      const o = (f * NZ + j) * 3
      surface[o] = frameX(f)
      surface[o + 1] = hi[f * NZ + j]
      surface[o + 2] = HALF_W - (j * DZ) / UPS
    }
  }
  const surfaceIndex = new Uint32Array((FRAMES - 1) * (NZ - 1) * 6)
  let w = 0
  for (let f = 0; f < FRAMES - 1; f++) {
    for (let j = 0; j < NZ - 1; j++) {
      const a = f * NZ + j
      const b = a + 1
      const c = a + NZ
      const d = c + 1
      surfaceIndex[w++] = a
      surfaceIndex[w++] = b
      surfaceIndex[w++] = c
      surfaceIndex[w++] = b
      surfaceIndex[w++] = d
      surfaceIndex[w++] = c
    }
  }
  const occluder = new BufferGeometry()
  occluder.setAttribute("position", new BufferAttribute(surface, 3))
  occluder.setIndex(new BufferAttribute(surfaceIndex, 1))

  // --- The lane, its floor and its curvature -------------------------------
  // The lane runs on, straight, over the flat ground before and after the data.
  const knots = [
    [-200, meta.lane[0][1]],
    ...meta.lane.filter((k, i) => i === 0 || k[0] > meta.lane[i - 1][0]),
    [560, meta.lane[meta.lane.length - 1][1]],
  ]
  const laneBin = pchip(
    knots.map((k) => k[0]),
    knots.map((k) => k[1]),
  )
  const lane = (x: number) => binZ(laneBin(x / DX))

  const PAD = 220
  const span = FRAMES + PAD * 2
  const corridor = new Float32Array(span)
  for (let f = 0; f < FRAMES; f++) {
    const centre = Math.round(laneBin(f))
    let m = 0
    for (let b = centre - 6; b <= centre + 6; b++) {
      if (b >= 0 && b < BINS) m = Math.max(m, height[f * BINS + b])
    }
    corridor[f + PAD] = m
  }
  const dilated = new Float32Array(span)
  for (let i = 0; i < span; i++) {
    let m = 0
    for (let k = -10; k <= 10; k++) m = Math.max(m, corridor[clamp(i + k, 0, span - 1)])
    dilated[i] = m
  }
  blur1d(dilated, 5)
  blur1d(dilated, 3)
  const floor = (x: number) => sample1d(dilated, x / DX + PAD)

  const curvature = new Float32Array(span)
  for (let i = 0; i < span; i++) {
    const x = frameX(i - PAD)
    curvature[i] = (lane(x + DX * 4) - 2 * lane(x) + lane(x - DX * 4)) / (DX * DX * 16)
  }
  blur1d(curvature, 12)
  const bend = (x: number) => sample1d(curvature, x / DX + PAD)

  // --- Pitch: a smooth track for the camera, a truer one for the rope -------
  const norm = (hz: number) => clamp((hz - f0Range[0]) / Math.max(1, f0Range[1] - f0Range[0]))
  const filled = new Float32Array(FRAMES)
  const voiced: number[] = []
  for (let f = 0; f < FRAMES; f++) if (f0[f] > 0) voiced.push(f)
  for (let f = 0, k = 0; f < FRAMES; f++) {
    while (k < voiced.length - 1 && voiced[k + 1] <= f) k++
    const a = voiced[k]
    const b = voiced[Math.min(voiced.length - 1, k + 1)]
    if (f <= a || a === b) filled[f] = norm(f0[a])
    else filled[f] = norm(f0[a]) + ((norm(f0[b]) - norm(f0[a])) * (f - a)) / (b - a)
  }
  const fine = blur1d(Float32Array.from(filled), 2)
  const coarse = blur1d(Float32Array.from(filled), 14)
  const pitch = (x: number) => sample1d(coarse, x / DX)

  const ropes: Poly[] = []
  let start = -1
  for (let f = 0; f <= FRAMES; f++) {
    const on = f < FRAMES && f0[f] > 0
    if (on && start < 0) start = f
    if (!on && start >= 0) {
      const n = f - start
      if (n >= 8) {
        const pts = new Float32Array(n * 3)
        const info = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
          const x = frameX(start + i)
          pts[i * 3] = x
          pts[i * 3 + 1] = floor(x) + ROPE_BASE + ROPE_AMP * fine[start + i]
          pts[i * 3 + 2] = lane(x)
          info[i * 3 + 1] = 1
        }
        ropes.push({ pts, info, level: 99 })
      }
      start = -1
    }
  }
  const rope = buildFatLines(ropes)

  return {
    lines,
    occluder,
    rope,
    lane,
    bend,
    floor,
    pitch,
    dispose: () => {
      lines.dispose()
      occluder.dispose()
      rope.dispose()
    },
  }
}

export async function loadTerrain(signal: AbortSignal): Promise<Terrain> {
  const [buffer, meta] = await Promise.all([
    fetch("/lab/voice/terrain.bin", { signal }).then((r) => r.arrayBuffer()),
    fetch("/lab/voice/terrain.json", { signal }).then((r) => r.json() as Promise<Partial<TerrainMeta>>),
  ])
  const bytes = new Uint8Array(buffer)
  if (bytes.length !== FRAMES * BINS) {
    throw new Error(`terrain.bin: expected ${FRAMES * BINS} bytes, got ${bytes.length}`)
  }
  const { f0, lane, layout, f0Range } = meta
  if (!f0 || !lane?.length || !layout || !f0Range) {
    throw new Error("terrain.json has no lane, layout or f0Range: regenerate it with tools/voice/make_terrain.py")
  }
  return buildTerrain(bytes, { f0, lane, layout, f0Range })
}
