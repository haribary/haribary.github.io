import { clamp, lerp, path3, pchip, smooth, smoother, type Vec3 } from "./math"
import type { Marks } from "./companion"
import { FRAMES, HALF_W, LENGTH, ROPE_AMP, type Terrain } from "./terrain"

/**
 * The whole page is one number, `u`, the story time. Scroll position maps to
 * `u` through the sections of the document (each section is one unit long, see
 * index.tsx), and everything on screen is a pure function of `u` and the
 * viewport: camera, heights, which of the three schemes, fog. Nothing here
 * keeps state, so any scroll position always renders the same frame.
 *
 *   0..1   the figure, seen from above          5..8   the second range, one
 *   1..2   the tilt down into it                       project per unit
 *   2..3   the first range (About)              8..9   the climb back to the
 *   3..4   its high pass, where the                    figure (Contact)
 *          kaleidoscope comes in
 *   4..5   the plain (Research); night falls in its empty last stretch
 *
 * Three schemes: day (cool paper, ink) for the Figure and About; the
 * kaleidoscope (a warmer white, ink, the gem's colours) for Research; night
 * (deep blue, gold) for Projects and Contact. Each arrives as spots.
 *
 * The land is always laid out the same way, whatever was recorded (see
 * tools/voice/README.md): the first range from x = 2 to 32, the plain to 46,
 * the second range to 68. The distances below are placed on that layout.
 *
 * This file is the camera and the land. The glass shards that travel with the
 * camera have their own timeline over the same `u`, in companion.ts.
 */
export const U_END = 9

/**
 * The chapter list. A chapter is a stretch of land, and a stretch with no text
 * on it belongs to the chapter it leads into or out of: the tilt is still the
 * Figure, the pass where the kaleidoscope comes in is already Research, the
 * climb is Contact.
 * The label that is emphasised and the marker beside it both come from this
 * one table, so they always name the same chapter.
 */
export const CHAPTERS = [
  { id: "figure", label: "Figure", from: 0 },
  { id: "about", label: "About", from: 1.95 },
  { id: "research", label: "Research", from: 3 },
  { id: "projects", label: "Projects", from: 4.95 },
  { id: "contact", label: "Contact", from: 7.95 },
] as const

/** The kaleidoscope comes in between these two story times, over the first range's pass. */
export const BLOOM_FROM = 3.1
export const BLOOM_TO = 3.9
/** Which pattern of spots each scheme arrives in (see spots.ts). */
export const NIGHT_SEED = 1
export const BLOOM_SEED = 2

/** How far the kaleidoscope has come at story time `u`, 0..1. */
export function bloom(u: number) {
  return smooth(BLOOM_FROM, BLOOM_TO, u)
}

/**
 * How far night has come at story time `u`, 0..1: it falls in the empty
 * stretch at the end of Research, which the page measures. It arrives as
 * spots; the shaders and the chapter list both ask spots.ts with this number,
 * so they agree about every place on the screen.
 */
export function nightfall(u: number, marks: Marks) {
  return smooth(marks.nightFrom, marks.nightTo, u)
}

/**
 * The width to draw the top-down figure at, given the room for it. On a
 * screen where the canvas is pixel-exact the strokes are spaced a whole number
 * of device pixels apart, so the engraving is even; otherwise the width is kept.
 */
export function snapFigure(width: number, dpr: number, exact: boolean) {
  if (!exact) return width
  const strokes = FRAMES - 1
  const spacing = (width / strokes) * dpr
  let n = Math.round(spacing)
  if ((n * strokes) / dpr > width * 1.02) n = Math.floor(spacing)
  if (n < 2) return width
  return (n * strokes) / dpr
}

/** A rectangle of the page the top-down figure is framed into, in CSS px. */
export type Slot = { cx: number; cy: number; w: number; h: number }
export type View = {
  w: number
  h: number
  hero: Slot
  end: Slot
  /** True when the text sits under the picture instead of beside it. */
  stacked: boolean
  /** The canvas's pixel ratio, and whether that is the screen's own (no upscaling). */
  dpr: number
  exact: boolean
}

export type Shot = {
  pos: Vec3
  target: Vec3
  up: Vec3
  fov: number
  /** 0..1: how far the vanishing point moves off centre to clear the text. */
  shift: number
  rise: number
  fill: number
  /** 0 while the sheet is paper, 1 once the flat ground around the figure is drawn. */
  ground: number
  /** 0..1: how far the kaleidoscope, and then night, has come over the screen. */
  bloom: number
  night: number
  fogNear: number
  fogFar: number
  /** 0..1: how much the drawing gives way under the text column. */
  quiet: number
}

export function createShot(): Shot {
  return {
    pos: [0, 0, 0],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 46,
    shift: 0,
    rise: 0,
    fill: 1,
    ground: 0,
    bloom: 0,
    night: 0,
    fogNear: 100,
    fogFar: 400,
    quiet: 0,
  }
}

const SIDE = 0.26
const LOOK_AHEAD = 7
const BANK = 1.3

export function fovFor(view: View) {
  const aspect = view.w / view.h
  return aspect >= 1.3 ? 46 : lerp(46, 64, clamp((1.3 - aspect) / 0.8))
}

export function createRig(terrain: Terrain, view: View, marks: Marks) {
  const { lane, floor, pitch, bend } = terrain
  const fov = fovFor(view)
  const stacked = view.stacked
  const tanHalf = Math.tan((fov * Math.PI) / 360)

  // --- Flight: along the lane, at a clearance above its floor ---------------
  // Slow across the plain while Research is read, then one even glide up
  // through the second range to its high pass, where the climb begins.
  const xOf = pchip(
    [0.9, 1.4, 1.8, 2.0, 3.0, 4.0, 5.0, 5.6, 7.86, 8.4, 9.0],
    [-13, -9.5, -6, -3.5, 19, 29.5, 33.2, 38.2, 58.8, 62.4, 64.4],
  )
  const clearance = pchip(
    [1.4, 2.0, 2.9, 3.4, 4.6, 5.2, 8.0, 9.0],
    [1.1, 0.85, 0.85, 1.2, 1.2, 0.8, 0.8, 1.5],
  )
  const along = (u: number, pos: Vec3) => {
    const x = xOf(u)
    pos[0] = x
    pos[1] = floor(x) + clearance(u) + ROPE_AMP * 0.6 * pitch(x)
    pos[2] = lane(x) - SIDE
    return pos
  }

  const flight = (u: number, pos: Vec3, target: Vec3, up: Vec3) => {
    along(u, pos)
    const x = pos[0]
    const tx = x + LOOK_AHEAD
    target[0] = tx
    target[1] = floor(tx) + clearance(u) * 0.4 + ROPE_AMP * 0.6 * pitch(tx)
    target[2] = lane(tx) - SIDE * 0.4
    up[0] = 0
    up[1] = 1
    up[2] = BANK * bend(x + 2)
  }

  // --- Top-down framings: the figure fitted into a slot of the page ---------
  // `centre` is the world x that sits at the slot's centre. With a pixel-exact
  // canvas the strokes land a whole number of device pixels apart and on pixel
  // centres, so every stroke of a given weight is drawn identically.
  const top = (slot: Slot, figWidth: number, centre: number) => {
    const figW = snapFigure(Math.min(figWidth, (slot.h * LENGTH) / (2 * HALF_W)), view.dpr, view.exact)
    const pxPerUnit = figW / LENGTH
    const height = view.h / (2 * tanHalf * pxPerUnit)
    const z = -(slot.cy - view.h / 2) / pxPerUnit
    let x = centre + (view.w / 2 - slot.cx) / pxPerUnit
    if (view.exact) {
      const first = (slot.cx - centre * pxPerUnit) * view.dpr
      x += (first - (Math.floor(first) + 0.5)) / (view.dpr * pxPerUnit)
    }
    return { pos: [x, height, z] as Vec3, target: [x, 0, z] as Vec3 }
  }
  // On a phone the opening figure is cropped to the first range so it has
  // presence; the closing one shows the whole length.
  const hero = stacked
    ? top({ ...view.hero, cx: view.w / 2 }, view.w * 1.9, LENGTH * 0.24)
    : top(view.hero, view.hero.w, LENGTH / 2)
  const end = top(view.end, view.end.w, LENGTH / 2)

  // --- The tilt: one descending arc from above the page into the lane -------
  const TILT_END = 1.9
  const f0: { pos: Vec3; target: Vec3; up: Vec3 } = { pos: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] }
  flight(TILT_END, f0.pos, f0.target, f0.up)
  const hH = hero.pos[1]
  const hX = hero.pos[0]
  const hZ = hero.pos[2]
  // In plan it sweeps out toward the bottom of the page, round the near end of
  // the figure and into the lane, always looking at the first range. The last
  // stretch is measured from the lane, wherever this recording puts it.
  const z0 = lane(0)
  const tiltU = [0, 0.3, 0.75, 1.1, 1.4, 1.65, TILT_END]
  const tiltPos = path3(tiltU, [
    hero.pos,
    [hX, hH * 0.985, hZ],
    [lerp(hX, 24, 0.8), hH * 0.6, hZ + 24],
    [9, hH * 0.27, 18],
    [-5.5, 6, z0 + 10.2],
    [-10.5, 2.3, z0 + 3.7],
    [...f0.pos],
  ])
  const tiltTarget = path3(tiltU, [
    hero.target,
    hero.target,
    [lerp(hX, 14, 0.75), 0, lerp(hZ, 0, 0.6)],
    [8.5, 0, lerp(0, z0, 0.5) + 0.2],
    [6.5, 0.6, z0 + 0.1],
    [4, 0.9, z0],
    [...f0.target],
  ])
  const tiltUp = path3(tiltU, [
    [0, 0, -1],
    [0, 0, -1],
    [0, 0.5, -1],
    [0, 1, -0.6],
    [0, 1, -0.2],
    [0, 1, 0],
    [0, 1, 0],
  ])

  // --- The climb: the same arc in reverse, from the far end, at night -------
  // It begins on the second range's high pass: the camera rises and tips down
  // at once, so the range it has just flown fills the frame before it leaves.
  const CLIMB_FROM = 7.86
  const CLIMB_SET = 8.14
  const f1: { pos: Vec3; target: Vec3; up: Vec3 } = { pos: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] }
  flight(CLIMB_FROM, f1.pos, f1.target, f1.up)
  const eH = end.pos[1]
  const eX = end.pos[0]
  const eZ = end.pos[2]
  // Measured from where the flight is when it starts, so it follows the lane.
  const cX = f1.pos[0]
  const cZ = f1.pos[2]
  const climbU = [CLIMB_FROM, 8.08, 8.3, 8.6, 8.86, U_END]
  const climbPos = path3(climbU, [
    [...f1.pos],
    [cX + 1.7, f1.pos[1] + 4, cZ + 2.2],
    [cX - 0.3, f1.pos[1] + 10.3, cZ + 5.3],
    [lerp(eX, cX - 0.3, 0.35), eH * 0.6, eZ + 6],
    end.pos,
    end.pos,
  ])
  const climbTarget = path3(climbU, [
    [...f1.target],
    [cX + 1.3, 1.0, cZ + 0.2],
    [cX - 3.3, 0.5, cZ + 1.6],
    [lerp(eX, cX - 3.3, 0.25), 0, lerp(eZ, cZ + 1.6, 0.25)],
    end.target,
    end.target,
  ])
  const climbUp = path3(climbU, [
    [0, 1, 0],
    [0.35, 1, -0.1],
    [0, 1, -0.3],
    [0, 0.4, -1],
    [0, 0, -1],
    [0, 0, -1],
  ])

  // Fog: far enough to see the whole sheet from above, close in flight. On the
  // plain it closes in while the voice and the tower stand, so the second
  // range is only a trace behind the glass, and opens again as night falls.
  const closed = Math.max(marks.hass, 4.04)
  const lifting = Math.max(closed + 0.04, marks.holdTo + 0.1 * marks.perScreen)
  const open = Math.max(lifting + 0.04, lerp(marks.nightFrom, marks.nightTo, 0.45))
  const fogFar = pchip(
    [0.3, 0.8, 1.2, 1.6, 1.9, 3.0, 3.9, closed, lifting, open, 7.88, 8.08, 8.3, 8.6, 8.83],
    [900, 320, 120, 52, 36, 36, 46, 19, 19, 38, 38, 60, 110, 400, 900].map(Math.log),
  )

  const a: Vec3 = [0, 0, 0]
  const b: Vec3 = [0, 0, 0]
  const c: Vec3 = [0, 0, 0]
  const mix3 = (out: Vec3, p: Vec3, q: Vec3, t: number) => {
    out[0] = lerp(p[0], q[0], t)
    out[1] = lerp(p[1], q[1], t)
    out[2] = lerp(p[2], q[2], t)
  }

  const evaluate = (uRaw: number, shot: Shot) => {
    const u = clamp(uRaw, 0, U_END)
    flight(u, shot.pos, shot.target, shot.up)

    if (u < TILT_END) {
      const t = smoother(1.5, TILT_END, u)
      mix3(shot.pos, tiltPos(u, a), shot.pos, t)
      mix3(shot.target, tiltTarget(u, b), shot.target, t)
      mix3(shot.up, tiltUp(u, c), shot.up, t)
    } else if (u > CLIMB_FROM) {
      const t = smoother(CLIMB_FROM, CLIMB_SET, u)
      mix3(shot.pos, shot.pos, climbPos(u, a), t)
      mix3(shot.target, shot.target, climbTarget(u, b), t)
      mix3(shot.up, shot.up, climbUp(u, c), t)
    }

    shot.fov = fov
    shot.shift = smoother(0.95, 1.9, u) * (1 - smoother(7.92, 8.4, u))
    shot.rise = smoother(0.5, 1.6, u) * (1 - smoother(8.28, 8.84, u))
    shot.fill = 1 - smoother(0.4, 1.3, u) * (1 - smoother(8.23, 8.78, u))
    shot.ground = smoother(0.85, 1.5, u) * (1 - smoother(8.13, 8.58, u))
    shot.bloom = bloom(u)
    shot.night = nightfall(u, marks)
    shot.fogFar = Math.exp(fogFar(u))
    shot.fogNear = shot.fogFar * 0.2
    // The drawing clears a column for the text, except in the two stretches
    // with no text on them, where one scheme comes over another.
    const span = marks.nightTo - marks.nightFrom
    const change =
      smoother(3.0, 3.2, u) * (1 - smoother(3.8, 4.0, u)) +
      smoother(marks.nightFrom - 0.02, marks.nightFrom + 0.2 * span, u) *
        (1 - smoother(marks.nightTo - 0.3 * span, marks.nightTo, u))
    shot.quiet = smoother(1.5, 1.95, u) * (1 - smoother(7.88, 8.15, u)) * (1 - 0.8 * change)

    return shot
  }

  return { evaluate, stacked }
}

export type Rig = ReturnType<typeof createRig>
