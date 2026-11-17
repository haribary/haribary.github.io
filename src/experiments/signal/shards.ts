/**
 * The shards: 96 pieces of glass that can be put together five ways.
 *
 *   stone   an irregular cut gem: a convex solid whose flat faces divide into
 *           exactly 96 triangles; each shard is the wedge under one of them
 *   photo   a 4:5 sheet cracked into 96 thin tiles (20 points on its edge and
 *           39 inside triangulate into 2 * 39 + 20 - 2 = 96)
 *   voice   a row of 48 upright bars, two shards each: a waveform in glass
 *   tower   four discs of a Tower of Hanoi, each a twelve-sided ring cut into
 *           24 wedges
 *   cover   a second cracked sheet, landscape, for the project images
 *
 * Every shard has the same topology in all of them: an outer triangle, an
 * inner triangle and three sides. For each formation a shard stores where its
 * centre is, which way it is turned, and its six corners in its own frame, so
 * the vertex shader can fly it as a rigid body from any formation to any other
 * and only ease its shape. All of that goes to the shader as one small table
 * (a float texture, one row per shard); the vertices themselves only say which
 * shard and which corner they are. Everything is generated from fixed seeds:
 * the same stone, the same cracks, on every load.
 *
 * This file has no imports, so the generator can be run and checked on its own.
 */

export const SHARD_COUNT = 96
/** Vertices per shard: two caps and three sides, unshared so each face is flat. */
export const SHARD_VERTS = 24

/** The formations, as the shader numbers them. */
export const FORM = { stone: 0, photo: 1, voice: 2, tower: 3, cover: 4 } as const
export type Form = (typeof FORM)[keyof typeof FORM]
export const FORM_COUNT = 5
/**
 * Texels per formation in a shard's row of the table: centre (w: when the
 * shard sets off toward this formation, 0..1), orientation, then the six
 * corners. A corner's w is, for the three outer ones, how firmly the edge
 * opposite is drawn (0 a crack across a flat face, 1 a true edge, 2 the rim
 * of a sheet); for the three inner ones, the formation's own tag for the
 * shard (see `tag` below).
 */
export const FORM_TEXELS = 8

type V3 = [number, number, number]
type V2 = [number, number]
type Quat = [number, number, number, number]
/**
 * One piece of a formation: its outer face (counter-clockwise from outside)
 * and inner face. `crease` is, for the edge opposite each outer corner, how
 * firmly it is drawn. `tag` is whatever the formation needs to know about the
 * piece: how near the rim a tile is, which bar, which disc.
 */
type Piece = { outer: [V3, V3, V3]; inner: [V3, V3, V3]; crease?: [number, number, number]; tag?: number }

// --- Dimensions --------------------------------------------------------------

/** The two sheets are one unit tall. */
export const PHOTO = { w: 0.8, h: 1, thick: 0.018 } as const
export const COVER = { w: 1.76, h: 1, thick: 0.018 } as const

/**
 * The voice: a row one unit wide. Bars stand in syllables, a little apart;
 * `groups` is how many bars each syllable has.
 */
export const VOICE = {
  bars: 48,
  groups: [9, 11, 8, 12, 8],
  /** Extra room between two syllables, in bar pitches. */
  pause: 0.7,
  tall: 0.36,
  thick: 0.03,
} as const

/**
 * The tower, in the units the Hanoi solver's motion was tuned for; `unit`
 * scales them so the whole tower is one unit wide, which is what the shader
 * and the choreography work in.
 */
const TOWER_SPACING = 2.3
const TOWER_RADII = [0.5, 0.67, 0.84, 1.0] as const
const TOWER_DISC_H = 0.36
const TOWER_GAP = 0.016
const TOWER_WIDTH = TOWER_SPACING * 2 + TOWER_RADII[3] * 2
const TOWER_PEG_TOP = 4 * (TOWER_DISC_H + TOWER_GAP) + 0.36
export const TOWER = {
  discs: 4,
  sides: 12,
  /** Smallest disc first, as the solver numbers them. */
  radii: TOWER_RADII,
  hole: 0.15,
  discH: TOWER_DISC_H,
  gap: TOWER_GAP,
  spacing: TOWER_SPACING,
  pegX: [-TOWER_SPACING, 0, TOWER_SPACING],
  pegTop: TOWER_PEG_TOP,
  /** Height of a disc's centre while it travels between pegs. */
  lift: TOWER_PEG_TOP + TOWER_DISC_H / 2 + 0.16,
  baseHalf: TOWER_WIDTH / 2 + 0.12,
  /** The height the tower is centred on when it is placed on screen. */
  mid: 1.02,
  unit: 1 / TOWER_WIDTH,
} as const

/**
 * How far the whole cloud turns, about the line of sight, while the stone
 * becomes a sheet or the row of bars (and back). The pairings below are
 * worked out with that turn already made, so the flights do not cross.
 */
export const SWIRL_SHEET = 1.25
export const SWIRL_VOICE = 0.7

// --- Small vector helpers ----------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const mid3 = (a: V3, b: V3, c: V3): V3 => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]

/** Deterministic random numbers in [0, 1). */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- The stone -----------------------------------------------------------------

const STONE_SEED = 1
/** How many flat cuts the stone has. Each becomes a face of three sides or more. */
const STONE_CUTS = 20

/**
 * The stone is what is left of a rounded, slightly lopsided body after a
 * couple of dozen flat cuts: a convex solid whose faces are polygons. Where
 * three cuts meet is a corner; a solid of F such faces has 2F - 4 corners and
 * its faces split into 4F - 12 triangles, so 27 cuts would give exactly 96.
 * Fewer, larger faces read better as a cut stone, so there are fewer cuts and
 * the largest faces are instead divided from their middle, which adds two
 * triangles each, until there are 96. Shards that share a face lie in one
 * plane, and the cracks between them are not drawn, so assembled the stone
 * reads as one solid piece.
 */
function buildStone(seed: number): { pieces: Piece[]; quality: number } | null {
  const rnd = mulberry(seed)
  // Directions of the cuts, spread over the sphere and pushed apart a little.
  const dirs: V3[] = []
  for (let i = 0; i < STONE_CUTS - 1; i++) {
    const y = 1 - (2 * (i + 0.5)) / (STONE_CUTS - 1)
    const r = Math.sqrt(1 - y * y)
    const a = i * 2.39996323 + rnd() * 1.2
    const jitter = () => (rnd() - 0.5) * 0.5
    dirs.push(norm([Math.cos(a) * r + jitter(), y + jitter(), Math.sin(a) * r + jitter()]))
  }
  // The table (below) takes the place of whichever cuts would crowd it.
  const table = norm([0.16, 0.22, 1] as V3)
  for (let round = 0; round < 8; round++) {
    const push: V3[] = dirs.map(() => [0, 0, 0])
    for (let i = 0; i < dirs.length; i++) {
      for (let j = 0; j < dirs.length; j++) {
        if (i === j) continue
        const d = sub(dirs[i], dirs[j])
        const l = Math.max(len(d), 0.08)
        if (l > 0.9) continue
        push[i] = add(push[i], mul(d, 0.02 / (l * l * l)))
      }
      const t = sub(dirs[i], table)
      const tl = Math.max(len(t), 0.08)
      if (tl < 1.1) push[i] = add(push[i], mul(t, 0.05 / (tl * tl * tl)))
    }
    for (let i = 0; i < dirs.length; i++) {
      const l = len(push[i])
      dirs[i] = norm(add(dirs[i], l > 0.15 ? mul(push[i], 0.15 / l) : push[i]))
    }
  }
  // How far out each cut is made: the body is taller than wide, deeper below
  // its middle than above, and no two cuts are made to the same depth.
  const planes = dirs.map((n) => {
    const up = Math.min(1, Math.max(0, (n[1] + 0.3) / 0.6))
    const t = up * up * (3 - 2 * up)
    const body = Math.hypot(n[0] * (0.29 + 0.05 * t), n[1] * (0.62 - 0.19 * t), n[2] * (0.26 + 0.04 * t))
    return { n, d: body * (0.93 + 0.14 * rnd()) + 0.03 * n[0] * n[1] }
  })
  // One broad face toward the viewer, a little off square: the table.
  planes.push({ n: table, d: 0.235 })

  // Corners: wherever three cuts meet inside all the others.
  const F = planes.length
  const corners: { p: V3; of: number[] }[] = []
  for (let i = 0; i < F; i++) {
    for (let j = i + 1; j < F; j++) {
      for (let k = j + 1; k < F; k++) {
        const [a, b, c] = [planes[i], planes[j], planes[k]]
        const bc = cross(b.n, c.n)
        const det = dot(a.n, bc)
        if (Math.abs(det) < 1e-7) continue
        const p = mul(add(add(mul(bc, a.d), mul(cross(c.n, a.n), b.d)), mul(cross(a.n, b.n), c.d)), 1 / det)
        let inside = true
        for (let m = 0; m < F && inside; m++) {
          if (m !== i && m !== j && m !== k && dot(planes[m].n, p) > planes[m].d - 1e-7) inside = false
        }
        if (inside) corners.push({ p, of: [i, j, k] })
      }
    }
  }

  // Faces: the corners on each cut, in order round it.
  type Face = { n: V3; ring: V3[]; middle: V3; area: number }
  const faces: Face[] = []
  for (let i = 0; i < F; i++) {
    const on = corners.filter((c) => c.of.includes(i)).map((c) => c.p)
    if (on.length < 3) continue
    const n = planes[i].n
    let middle: V3 = [0, 0, 0]
    for (const p of on) middle = add(middle, mul(p, 1 / on.length))
    const ax = norm(sub(on[0], middle))
    const ay = cross(n, ax)
    const ring = on
      .map((p) => ({ p, a: Math.atan2(dot(sub(p, middle), ay), dot(sub(p, middle), ax)) }))
      .sort((p, q) => p.a - q.a)
      .map((p) => p.p)
    let area = 0
    for (let k = 0; k < ring.length; k++) {
      area += dot(n, cross(sub(ring[k], middle), sub(ring[(k + 1) % ring.length], middle))) / 2
    }
    // No edge of a face may be a mere nick.
    for (let k = 0; k < ring.length; k++) {
      if (len(sub(ring[k], ring[(k + 1) % ring.length])) < 0.03) return null
    }
    faces.push({ n, ring, middle, area })
  }

  // Divide the largest faces from their middle until there are 96 triangles.
  const plain = faces.reduce((acc, f) => acc + f.ring.length - 2, 0)
  const fans = (SHARD_COUNT - plain) / 2
  if (fans < 0 || fans > faces.length || !Number.isInteger(fans)) return null
  const bySize = faces
    .map((f, i) => ({ i, rank: f.area * (f.ring.length > 4 ? 4 : 1) }))
    .sort((a, b) => b.rank - a.rank)
  const fanned = new Set(bySize.slice(0, fans).map((f) => f.i))

  type Tri = { v: [V3, V3, V3]; crease: [number, number, number] }
  const tris: Tri[] = []
  faces.forEach((f, i) => {
    const k = f.ring.length
    if (fanned.has(i)) {
      // Corner 0 is the middle, so the edge opposite it is the face's own edge.
      for (let j = 0; j < k; j++) tris.push({ v: [f.middle, f.ring[j], f.ring[(j + 1) % k]], crease: [1, 0, 0] })
      return
    }
    // Otherwise a zigzag across the face, which keeps the triangles stout.
    let lo = 0
    let hi = k - 1
    let flip = false
    while (hi - lo > 1) {
      if (!flip) {
        // lo, lo + 1, hi: the edge lo..lo+1 is the face's own; hi..lo is too on the first.
        tris.push({ v: [f.ring[lo], f.ring[lo + 1], f.ring[hi]], crease: [hi - lo === 2 ? 1 : 0, lo === 0 ? 1 : 0, 1] })
        lo++
      } else {
        tris.push({ v: [f.ring[lo], f.ring[hi - 1], f.ring[hi]], crease: [1, 0, hi - lo === 2 ? 1 : 0] })
        hi--
      }
      flip = !flip
    }
  })
  if (tris.length !== SHARD_COUNT) return null

  // Centre it and make it one unit tall.
  let lo: V3 = [Infinity, Infinity, Infinity]
  let hi: V3 = [-Infinity, -Infinity, -Infinity]
  for (const c of corners) {
    lo = [Math.min(lo[0], c.p[0]), Math.min(lo[1], c.p[1]), Math.min(lo[2], c.p[2])]
    hi = [Math.max(hi[0], c.p[0]), Math.max(hi[1], c.p[1]), Math.max(hi[2], c.p[2])]
  }
  const centre = mul(add(lo, hi), 0.5)
  const scale = 1 / (hi[1] - lo[1])
  const fit = (p: V3) => mul(sub(p, centre), scale)

  // Each shard is the wedge under one triangle, reaching most of the way in.
  const CORE = 0.3
  let thinnest = Infinity
  const pieces = tris.map((t): Piece => {
    const outer: [V3, V3, V3] = [fit(t.v[0]), fit(t.v[1]), fit(t.v[2])]
    const e = [0, 1, 2].map((k) => len(sub(outer[(k + 1) % 3], outer[k]))).sort((a, b) => a - b)
    const area = len(cross(sub(outer[1], outer[0]), sub(outer[2], outer[0]))) / 2
    thinnest = Math.min(thinnest, (2 * area) / (e[1] * e[2]))
    return { outer, inner: [mul(outer[0], CORE), mul(outer[1], CORE), mul(outer[2], CORE)], crease: t.crease }
  })
  return { pieces, quality: thinnest }
}

// --- The sheets ----------------------------------------------------------------

const PHOTO_SEED = 11
const COVER_SEED = 23

function delaunay(pts: V2[]): [number, number, number][] {
  const n = pts.length
  const all: V2[] = [...pts, [-2000, -1500], [2000, -1500], [0, 2500]]
  let tris: [number, number, number][] = [[n, n + 1, n + 2]]
  const inCircle = (t: [number, number, number], px: number, py: number) => {
    const ax = all[t[0]][0] - px
    const ay = all[t[0]][1] - py
    const bx = all[t[1]][0] - px
    const by = all[t[1]][1] - py
    const cx = all[t[2]][0] - px
    const cy = all[t[2]][1] - py
    return (
      (ax * ax + ay * ay) * (bx * cy - cx * by) -
        (bx * bx + by * by) * (ax * cy - cx * ay) +
        (cx * cx + cy * cy) * (ax * by - bx * ay) >
      1e-12
    )
  }
  for (let p = 0; p < n; p++) {
    const keep: [number, number, number][] = []
    const edges = new Map<string, [number, number]>()
    for (const t of tris) {
      if (!inCircle(t, all[p][0], all[p][1])) {
        keep.push(t)
        continue
      }
      for (let k = 0; k < 3; k++) {
        const a = t[k]
        const b = t[(k + 1) % 3]
        const key = a < b ? `${a},${b}` : `${b},${a}`
        if (edges.has(key)) edges.delete(key)
        else edges.set(key, [a, b])
      }
    }
    tris = keep
    for (const [a, b] of edges.values()) tris.push([a, b, p])
  }
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n)
}

/**
 * A sheet of glass, w by h, cracked into 96 tiles. A tile's tag says how near
 * the rim it is: 1 with an edge on it, 0.5 with only a corner there, 0 inside.
 */
function buildSheet(sheet: { w: number; h: number; thick: number }, focus: V2) {
  return (seed: number): { pieces: Piece[]; quality: number } | null => {
    const rnd = mulberry(seed)
    const { w, h, thick } = sheet
    const pts: V2[] = []
    // The edge: four corners, three more along each short side, five along each long one.
    const along = (count: number) =>
      Array.from({ length: count }, (_, i) => (i + 1 + (rnd() - 0.5) * 0.5) / (count + 1) - 0.5)
    const wide = w > h
    pts.push([-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2])
    for (const t of along(wide ? 5 : 3)) pts.push([t * w, -h / 2])
    for (const t of along(wide ? 5 : 3)) pts.push([t * w, h / 2])
    for (const t of along(wide ? 3 : 5)) pts.push([-w / 2, t * h])
    for (const t of along(wide ? 3 : 5)) pts.push([w / 2, t * h])
    const rim = pts.length
    // Inside: each new point is the best of a handful of tries, where "best"
    // leans toward one off-centre spot, so the cracks are finer around it.
    for (let i = 0; i < 39; i++) {
      let best: V2 = [0, 0]
      let score = -1
      for (let k = 0; k < 24; k++) {
        const c: V2 = [(rnd() - 0.5) * (w - 0.07), (rnd() - 0.5) * (h - 0.07)]
        let near = Infinity
        for (const p of pts) near = Math.min(near, Math.hypot(p[0] - c[0], p[1] - c[1]))
        const s = near / (0.55 + Math.hypot(c[0] - focus[0], c[1] - focus[1]))
        if (s > score) {
          score = s
          best = c
        }
      }
      pts.push(best)
    }
    const tris = delaunay(pts)
    if (tris.length !== SHARD_COUNT) return null
    let area = 0
    let smallest = Infinity
    for (const t of tris) {
      const [a, b, c] = [pts[t[0]], pts[t[1]], pts[t[2]]]
      const s = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
      if (s <= 1e-6) return null
      area += s
      // Thinnest corner of the tile, as a sine: slivers make poor shards.
      const e = [
        Math.hypot(b[0] - a[0], b[1] - a[1]),
        Math.hypot(c[0] - b[0], c[1] - b[1]),
        Math.hypot(a[0] - c[0], a[1] - c[1]),
      ].sort((x, y) => x - y)
      smallest = Math.min(smallest, (2 * s) / (e[1] * e[2]))
    }
    if (Math.abs(area - w * h) > 1e-6) return null
    const pieces = tris.map((t): Piece => {
      const at = (i: number, z: number): V3 => [pts[t[i]][0], pts[t[i]][1], z]
      // An edge whose two ends are both rim points lies on the rim itself.
      const onRim = (k: number) => t[(k + 1) % 3] < rim && t[(k + 2) % 3] < rim
      const crease: [number, number, number] = [onRim(0) ? 2 : 1, onRim(1) ? 2 : 1, onRim(2) ? 2 : 1]
      const corners = t.filter((i) => i < rim).length
      return {
        outer: [at(0, thick / 2), at(1, thick / 2), at(2, thick / 2)],
        inner: [at(0, -thick / 2), at(1, -thick / 2), at(2, -thick / 2)],
        crease,
        tag: crease.includes(2) ? 1 : corners > 0 ? 0.5 : 0,
      }
    })
    return { pieces, quality: smallest }
  }
}

// --- The voice -----------------------------------------------------------------

/**
 * The row of bars: a sentence in glass. Each syllable is a swell of bars, and
 * a bar is a slab cut corner to corner into two shards, the cut folded back a
 * touch so its two halves catch the light differently. A piece's tag is
 * `bar + 64 * syllable`. Returned bar by bar from the left, two pieces each.
 */
function buildVoice(): Piece[] {
  const rnd = mulberry(404)
  const { bars, groups, pause, tall, thick } = VOICE
  const pitch = 1 / (bars + pause * (groups.length - 1))
  const wide = pitch * 0.68
  const loud = [0.72, 1, 0.58, 0.9, 0.5]
  const pieces: Piece[] = []
  let bar = 0
  groups.forEach((count, g) => {
    for (let j = 0; j < count; j++, bar++) {
      const swell = Math.pow(Math.sin((Math.PI * (j + 0.5)) / count), 0.8)
      const h = (0.035 + tall * loud[g] * swell * (0.86 + 0.28 * rnd())) / 2
      const x = -0.5 + (bar + pause * g + 0.5) * pitch
      const fold = thick * 0.4
      // Corners of the front, from the bottom left, counter-clockwise; the two
      // off the cut sit a little further back.
      const cut = bar % 2 === 0
      const z = (k: number) => thick / 2 - ((k % 2 === 1) === cut ? fold : 0)
      const xy: V2[] = [
        [x - wide / 2, -h],
        [x + wide / 2, -h],
        [x + wide / 2, h],
        [x - wide / 2, h],
      ]
      const front = (k: number): V3 => [xy[k][0], xy[k][1], z(k)]
      const back = (k: number): V3 => [xy[k][0], xy[k][1], -thick / 2]
      // The cut runs between corners 0 and 2, or 1 and 3 on every other bar.
      const halves = cut
        ? [
            [0, 1, 2],
            [0, 2, 3],
          ]
        : [
            [0, 1, 3],
            [1, 2, 3],
          ]
      for (const tri of halves) {
        const isCut = (k: number) => {
          const p = tri[(k + 1) % 3]
          const q = tri[(k + 2) % 3]
          return Math.abs(p - q) === 2
        }
        pieces.push({
          outer: [front(tri[0]), front(tri[1]), front(tri[2])],
          inner: [back(tri[0]), back(tri[1]), back(tri[2])],
          crease: [isCut(0) ? 0.4 : 1, isCut(1) ? 0.4 : 1, isCut(2) ? 0.4 : 1],
          tag: bar + 64 * g,
        })
      }
    }
  })
  return pieces
}

// --- The tower -----------------------------------------------------------------

/**
 * One disc, about its own centre: a twelve-sided top and a twelve-sided
 * bottom, turned half a step against each other, so the wall between them is
 * 24 triangles. Each shard is the wedge from one of those in to the hole. The
 * rims are drawn firmly, the slanting cuts in the wall lightly.
 */
function buildDisc(radius: number, disc: number): Piece[] {
  const { sides, hole, discH, unit } = TOWER
  const step = (Math.PI * 2) / sides
  const at = (r: number, a: number, y: number): V3 => [Math.cos(a) * r * unit, y * unit, Math.sin(a) * r * unit]
  const top = (r: number, j: number) => at(r, j * step, discH / 2)
  const bottom = (r: number, j: number) => at(r, (j + 0.5) * step, -discH / 2)
  const pieces: Piece[] = []
  for (let j = 0; j < sides; j++) {
    // A triangle hanging from the top edge, then one standing on the bottom edge.
    for (const pick of [
      [top, j, top, j + 1, bottom, j],
      [bottom, j, top, j + 1, bottom, j + 1],
    ] as const) {
      const tri = (r: number): [V3, V3, V3] => [pick[0](r, pick[1]), pick[2](r, pick[3]), pick[4](r, pick[5])]
      let outer = tri(radius)
      let inner = tri(hole)
      const c = mid3(outer[0], outer[1], outer[2])
      const n = cross(sub(outer[1], outer[0]), sub(outer[2], outer[0]))
      if (dot(n, [c[0], 0, c[2]]) < 0) {
        outer = [outer[0], outer[2], outer[1]]
        inner = [inner[0], inner[2], inner[1]]
      }
      const level = (k: number) => Math.abs(outer[(k + 1) % 3][1] - outer[(k + 2) % 3][1]) < 1e-9
      pieces.push({ outer, inner, crease: [level(0) ? 1 : 0.24, level(1) ? 1 : 0.24, level(2) ? 1 : 0.24], tag: disc })
    }
  }
  return pieces
}

// --- Frames --------------------------------------------------------------------

type Framed = { centre: V3; quat: Quat; local: V3[]; shift: number }

function quatFromAxes(x: V3, y: V3, z: V3): Quat {
  // Rotation matrix with columns x, y, z.
  const m00 = x[0], m01 = y[0], m02 = z[0]
  const m10 = x[1], m11 = y[1], m12 = z[1]
  const m20 = x[2], m21 = y[2], m22 = z[2]
  const tr = m00 + m11 + m22
  let q: Quat
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/** A piece in its own frame: z along the outer face's normal, origin at its centre. */
function frame(piece: Piece, shift: number, like: Framed | null): Framed & { miss: number } {
  const o = [0, 1, 2].map((k) => piece.outer[(k + shift) % 3])
  const i = [0, 1, 2].map((k) => piece.inner[(k + shift) % 3])
  const verts = [...o, ...i]
  let centre: V3 = [0, 0, 0]
  for (const v of verts) centre = add(centre, mul(v, 1 / 6))
  const z = norm(cross(sub(o[1], o[0]), sub(o[2], o[0])))
  let x = sub(o[0], centre)
  x = norm(sub(x, mul(z, dot(x, z))))
  let y = cross(z, x)
  let local = verts.map((v): V3 => {
    const d = sub(v, centre)
    return [dot(d, x), dot(d, y), dot(d, z)]
  })
  let miss = 0
  if (like) {
    // Turn the frame about its normal until the shape lies as close as it can
    // to the reference shape: the less a shard has to change, the more it
    // reads as one solid piece in flight.
    let sn = 0
    let cs = 0
    const size = (s: V3[]) => Math.sqrt(s.reduce((acc, v) => acc + v[0] * v[0] + v[1] * v[1], 0)) || 1
    const sa = size(like.local)
    const sb = size(local)
    for (let k = 0; k < 6; k++) {
      const a = like.local[k]
      const b = local[k]
      sn += b[0] * a[1] - b[1] * a[0]
      cs += b[0] * a[0] + b[1] * a[1]
    }
    const t = Math.atan2(sn, cs)
    const ct = Math.cos(t)
    const st = Math.sin(t)
    local = local.map((v): V3 => [v[0] * ct - v[1] * st, v[0] * st + v[1] * ct, v[2]])
    // The frame turns the other way, so the piece itself stays where it is.
    const x2 = add(mul(x, ct), mul(y, -st))
    const y2 = add(mul(x, st), mul(y, ct))
    x = x2
    y = y2
    for (let k = 0; k < 6; k++) {
      const a = like.local[k]
      const b = local[k]
      miss += Math.hypot(a[0] / sa - b[0] / sb, a[1] / sa - b[1] / sb)
    }
  }
  return { centre, quat: quatFromAxes(x, y, z), local, shift, miss }
}

/** The framing of `piece` (over its three possible corner orders) nearest in shape to `like`. */
function frameLike(piece: Piece, like: Framed): Framed {
  let best = frame(piece, 0, like)
  for (let s = 1; s < 3; s++) {
    const f = frame(piece, s, like)
    if (f.miss < best.miss) best = f
  }
  return best
}

// --- Who goes where --------------------------------------------------------------

/**
 * Pairs every source point with a target so the total squared distance is as
 * small as swapping pairs can make it. Paths chosen this way do not cross.
 */
function assign(from: V2[], to: V2[]): number[] {
  const n = from.length
  const cost = (i: number, j: number) => (from[i][0] - to[j][0]) ** 2 + (from[i][1] - to[j][1]) ** 2
  // Start greedy, nearest pairs first, then improve by swaps until none helps.
  const pairs: [number, number, number][] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pairs.push([cost(i, j), i, j])
  pairs.sort((a, b) => a[0] - b[0])
  const out = new Array<number>(n).fill(-1)
  const taken = new Array<boolean>(n).fill(false)
  for (const [, i, j] of pairs) {
    if (out[i] >= 0 || taken[j]) continue
    out[i] = j
    taken[j] = true
  }
  for (let round = 0; round < 60; round++) {
    let improved = false
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (cost(a, out[b]) + cost(b, out[a]) < cost(a, out[a]) + cost(b, out[b]) - 1e-12) {
          const t = out[a]
          out[a] = out[b]
          out[b] = t
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return out
}

// --- All together ----------------------------------------------------------------

export type ShardData = {
  vertices: number
  /** Per vertex: which shard, which corner (0..2 outer, 3..5 inner), which face (0 outer, 1 inner, 2 side). */
  position: Float32Array
  /** Distance to each edge of the face, 1 where an edge is only a diagonal. */
  bary: Float32Array
  /**
   * For the inner face and the sides, which edges are true edges of the
   * assembled solid (1) and which only cracks across a flat face (0). The
   * outer face takes its edges from the table instead, per formation.
   */
  edges: Float32Array
  /** Four random numbers per shard. */
  rand: Float32Array
  /** The table: `SHARD_COUNT` rows of `FORM_COUNT * FORM_TEXELS` RGBA texels. */
  table: Float32Array
  tableWidth: number
  tableHeight: number
}

function firstGood<T extends { quality: number }>(build: (seed: number) => T | null, seed: number, floor: number): T {
  for (let s = seed; s < seed + 400; s++) {
    const made = build(s)
    if (made && made.quality >= floor) return made
  }
  throw new Error("shards: no usable shape")
}

/**
 * Builds everything. `feed` is the order in which the row of bars feeds the
 * tower's discs, from the left: the tower forms part way through its
 * solution, so which disc stands where is the solver's business (tower.ts).
 */
export function buildShards(feed: readonly number[]): ShardData {
  const stone = firstGood(buildStone, STONE_SEED, 0.1).pieces
  const photo = firstGood(buildSheet(PHOTO, [-0.09, 0.12]), PHOTO_SEED, 0.38).pieces
  const cover = firstGood(buildSheet(COVER, [0.22, -0.08]), COVER_SEED, 0.38).pieces
  const voice = buildVoice()
  const discs = TOWER.radii.map((r, d) => buildDisc(r, d))
  const rnd = mulberry(1977)

  const centreOf = (p: Piece) => mid3(p.outer[0], p.outer[1], p.outer[2])

  // --- Stone to sheet: the stone unfolds. Each face is laid out by its
  // direction from the front of the stone (faces toward the viewer in the
  // middle, the back of the stone around the rim), turned by the swirl, and
  // matched to the nearest tile.
  const unfolded = (reach: V2) =>
    stone.map((p): V2 => {
      const d = norm(centreOf(p))
      const r = Math.sqrt(Math.max(0, (1 - d[2]) / 2))
      const a = Math.atan2(d[1], d[0]) + SWIRL_SHEET
      return [Math.cos(a) * r * reach[0], Math.sin(a) * r * reach[1]]
    })
  const tilesOf = (sheet: Piece[]) =>
    sheet.map((p): V2 => {
      const c = centreOf(p)
      return [c[0], c[1]]
    })
  const flat = unfolded([0.62, 0.62])
  const toPhoto = assign(flat, tilesOf(photo))
  const toCover = assign(unfolded([1.2, 0.62]), tilesOf(cover))
  let radiusMax = 0
  for (let i = 0; i < SHARD_COUNT; i++) radiusMax = Math.max(radiusMax, Math.hypot(flat[i][0], flat[i][1]))

  // --- Stone to voice: the stone is drawn out into a line. Its faces, turned
  // by the swirl, go to the bars in order from left to right.
  const across = stone
    .map((p, i) => {
      const c = centreOf(p)
      return { i, x: c[0] * Math.cos(SWIRL_VOICE) - c[1] * Math.sin(SWIRL_VOICE) }
    })
    .sort((a, b) => a.x - b.x)
  const toVoice = new Array<number>(SHARD_COUNT)
  across.forEach(({ i }, k) => (toVoice[i] = k))

  // --- Voice to tower: each stretch of the row gathers into one disc, and
  // within a disc the bars keep their order from left to right.
  const perDisc = SHARD_COUNT / TOWER.discs
  const toTower = new Array<{ disc: number; slot: number }>(SHARD_COUNT)
  for (let d = 0; d < TOWER.discs; d++) {
    const disc = feed[d]
    const slots = discs[disc].map((p, slot) => ({ slot, x: centreOf(p)[0] })).sort((a, b) => a.x - b.x)
    for (let k = 0; k < perDisc; k++) toTower[across[d * perDisc + k].i] = { disc, slot: slots[k].slot }
  }

  const vertices = SHARD_COUNT * SHARD_VERTS
  const tableWidth = FORM_COUNT * FORM_TEXELS
  const data: ShardData = {
    vertices,
    position: new Float32Array(vertices * 3),
    bary: new Float32Array(vertices * 3),
    edges: new Float32Array(vertices * 3),
    rand: new Float32Array(vertices * 4),
    table: new Float32Array(SHARD_COUNT * tableWidth * 4),
    tableWidth,
    tableHeight: SHARD_COUNT,
  }

  // Corner indices (0..2 outer A B C, 3..5 inner a b c) of the 8 triangles, and
  // for each corner its distance-to-edge triple. A side is a quad cut along a
  // diagonal; the diagonal's component is held at 1 so no edge is drawn on it.
  const A = 0, B = 1, C = 2, a = 3, b = 4, c = 5
  const TRIS: [number, V3][][] = [
    [[A, [1, 0, 0]], [B, [0, 1, 0]], [C, [0, 0, 1]]],
    [[a, [1, 0, 0]], [c, [0, 1, 0]], [b, [0, 0, 1]]],
  ]
  // Which edges of each triangle are true edges of the assembled solid. On a
  // side, the two long edges are; the short ones that run inward are shared
  // with the neighbouring shard's side, in the same plane.
  const TRUE_EDGES: V3[] = [[1, 1, 1], [1, 1, 1]]
  for (const [p, q, pi, qi] of [
    [A, B, a, b],
    [B, C, b, c],
    [C, A, c, a],
  ]) {
    TRIS.push([[p, [1, 1, 0]], [pi, [0, 1, 0]], [qi, [0, 1, 1]]])
    TRUE_EDGES.push([1, 1, 0])
    TRIS.push([[p, [1, 0, 1]], [qi, [0, 1, 1]], [q, [0, 0, 1]]])
    TRUE_EDGES.push([0, 1, 1])
  }

  for (let i = 0; i < SHARD_COUNT; i++) {
    const r = [rnd(), rnd(), rnd(), rnd()]
    const f0 = frame(stone[i], 0, null)
    const seat = toTower[i]
    const radial = Math.hypot(flat[i][0], flat[i][1]) / radiusMax
    // When a shard sets off toward each formation. A sheet grows from its
    // middle outward, a little spirally; the row of bars is laid from the
    // left; each disc closes like a fan.
    const sheetOrder = Math.min(1, 0.78 * radial + 0.14 * r[0] + 0.08)
    const forms: { piece: Piece; order: number }[] = []
    forms[FORM.stone] = { piece: stone[i], order: 0 }
    forms[FORM.photo] = { piece: photo[toPhoto[i]], order: sheetOrder }
    forms[FORM.voice] = {
      piece: voice[toVoice[i]],
      order: Math.min(1, (0.84 * toVoice[i]) / SHARD_COUNT + 0.16 * r[0]),
    }
    forms[FORM.tower] = {
      piece: discs[seat.disc][seat.slot],
      order: Math.min(1, 0.7 * (toVoice[i] % perDisc) / perDisc + 0.3 * r[0]),
    }
    forms[FORM.cover] = { piece: cover[toCover[i]], order: sheetOrder }

    forms.forEach(({ piece, order }, form) => {
      const f = form === FORM.stone ? f0 : frameLike(piece, f0)
      const at = (i * tableWidth + form * FORM_TEXELS) * 4
      data.table.set([...f.centre, order], at)
      data.table.set(f.quat, at + 4)
      for (let k = 0; k < 6; k++) {
        // Corner k of the shard is corner k + shift of the piece as it was made.
        const w = k < 3 ? (piece.crease?.[(k + f.shift) % 3] ?? 1) : (piece.tag ?? 0)
        data.table.set([...f.local[k], w], at + 8 + k * 4)
      }
    })

    let v = i * SHARD_VERTS
    TRIS.forEach((tri, t) => {
      const kind = t === 0 ? 0 : t === 1 ? 1 : 2
      for (const [corner, edge] of tri) {
        data.position.set([i, corner, kind], v * 3)
        data.bary.set(edge, v * 3)
        data.edges.set(TRUE_EDGES[t], v * 3)
        data.rand.set(r, v * 4)
        v++
      }
    })
  }
  return data
}
