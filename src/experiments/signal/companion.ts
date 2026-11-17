import { clamp, lerp, pchip, smooth, smoother } from "./math"
import { FORM, type Form } from "./shards"
import { BLOOM_FROM, U_END, type View } from "./story"
import { TOWER_MOVE_COUNT } from "./tower"

/**
 * The companion: one cluster of glass shards that comes along for the whole
 * page. Like the camera in story.ts it is a pure function of the story time
 * `u` and the viewport, and it keeps no state, so any scroll position always
 * shows the same thing. It lives on the screen, not in the land: every place
 * below is a position in CSS pixels from the top left of the window.
 *
 *   0..0.4    the stone rests on the figure      4..5   Research: the stone turns
 *   0.4..2    it lifts off and comes along              prism, becomes a voice
 *   2..3      About: a sheet of glass showing           that breaks down, then a
 *             three photographs                         Tower of Hanoi that solves
 *   3..4      stone again while night comes      5..8   Projects: a wide sheet
 *                                                       showing each project
 *                                                8..9   stone, back onto the figure
 */

/**
 * Story times the page measures from the DOM rather than fixing in advance,
 * all in Research: when the first paper comes to where it is read, the
 * stretch where the second is held in place while the tower solves, and the
 * empty stretch after it, where night falls.
 */
export type Marks = {
  hass: number
  holdFrom: number
  holdTo: number
  /** Story time that passes while one screen height scrolls by, in Research. */
  perScreen: number
  /** Night falls between these: once the held paper has left, until the Projects heading comes in. */
  nightFrom: number
  nightTo: number
}

export const DEFAULT_MARKS: Marks = {
  hass: 4.17,
  holdFrom: 4.32,
  holdTo: 4.54,
  perScreen: 0.22,
  nightFrom: 4.65,
  nightTo: 4.87,
}

/**
 * Marks as measured, kept inside the Research chapter and in order, so that
 * whatever the layout does the timeline below is still well formed.
 */
export function fitMarks(
  hass: number,
  holdFrom: number,
  holdTo: number,
  perScreen: number,
  nightFrom: number,
  nightTo: number,
): Marks {
  const from = clamp(holdFrom, 4.12, 4.7)
  const to = clamp(holdTo, from + 0.06, 4.8)
  const dusk = clamp(nightFrom, to + 0.02, 4.9)
  return {
    hass: clamp(hass, 4.04, from - 0.08),
    holdFrom: from,
    holdTo: to,
    perScreen: clamp(perScreen, 0.05, 0.8),
    nightFrom: dusk,
    nightTo: clamp(nightTo, dusk + 0.04, 4.97),
  }
}

/** The photographs: the sheet shows its first from here... */
const PHOTO_FROM = 2.26
/** ...and its last one until here. */
const PHOTO_TO = 2.86
/** How long, in story time, one turn of the tiles takes to cross a sheet. */
const FLIP = 0.1
/** The project images change as the next project's text arrives. */
const COVER_TURNS = [5.92, 6.92] as const
/** The wide sheet breaks back into the stone here, just before the climb. */
const COVER_OUT = [7.64, 7.83] as const

/**
 * Each picture has its own way of hanging: a small shift (fractions of the
 * viewport), a turn, a tilt and a size. The sheet drifts from one to the next
 * while its tiles turn over.
 */
type Pose = { dx: number; dy: number; yaw: number; roll: number; size: number }
const PHOTO_POSES: Pose[] = [
  { dx: 0, dy: 0, yaw: -0.2, roll: -0.012, size: 1 },
  { dx: 0.026, dy: -0.024, yaw: -0.1, roll: 0.034, size: 0.955 },
  { dx: -0.018, dy: 0.02, yaw: -0.27, roll: -0.03, size: 1.03 },
]
const COVER_POSES: Pose[] = [
  { dx: 0, dy: 0, yaw: -0.15, roll: 0.012, size: 1 },
  { dx: 0.018, dy: -0.03, yaw: -0.06, roll: -0.026, size: 0.965 },
  { dx: -0.014, dy: 0.022, yaw: -0.21, roll: 0.022, size: 1.02 },
]

export type Place = { x: number; y: number; size: number; yaw: number; pitch: number; roll: number }

export type Companion = {
  /** The story time this was evaluated at. */
  u: number
  /** The two formations the shards are between, and how far from the first to the second. */
  from: Form
  to: Form
  mix: number
  /**
   * Centre, size in px and attitude of each formation. The size is a height,
   * or for the voice and the tower a width.
   */
  stone: Place
  photo: Place
  voice: Place
  tower: Place
  cover: Place
  /** Which picture a sheet shows: 1.5 is half way through the turn from the second to the third. */
  flip: number
  /** Moves of the tower's last five made so far. */
  moves: number
  /** 0..1: how much of the pegs and the base is drawn. */
  pegs: number
  /** 0..1: how far the voice has broken down. */
  decay: number
  /** 0 outside Research .. 1 in it: the glass turns prismatic. */
  prism: number
  /** 0 lying on the sheet .. 1 afloat. */
  lift: number
}

const place = (): Place => ({ x: 0, y: 0, size: 100, yaw: 0, pitch: 0, roll: 0 })

export function createCompanion(): Companion {
  return {
    u: 0,
    from: FORM.stone,
    to: FORM.photo,
    mix: 0,
    stone: place(),
    photo: place(),
    voice: place(),
    tower: place(),
    cover: place(),
    flip: 0,
    moves: 0,
    pegs: 0,
    decay: 0,
    prism: 0,
    lift: 0,
  }
}

export type Layout = {
  view: View
  /** Right edge of the text column, as a fraction of the viewport width. */
  columnEdge: number
  marks: Marks
  /** How many photographs the first sheet has to show. */
  photos: number
  reduced: boolean
}

export function createDirector({ view, columnEdge, marks, photos, reduced }: Layout) {
  const { w, h, stacked } = view
  const TAU = Math.PI * 2

  // The open side of the page: beside the text column, or above the text.
  const left = stacked ? 0 : columnEdge * w
  const openW = w - left
  const openH = stacked ? 0.42 * h : h
  const spot = (fx: number, fy: number): [number, number] => [left + fx * openW, fy * openH]

  // --- Sizes -----------------------------------------------------------------
  const figure = (slotW: number) => slotW * (16.51 / 70.4)
  const base = stacked ? Math.min(0.14 * h, 0.3 * w) : clamp(0.19 * h, 110, 190)
  const heroFigure = stacked ? view.hero.h : Math.min(view.hero.h, figure(view.hero.w))
  const endFigure = Math.min(view.end.h, figure(view.end.w))
  const sizeHero = Math.min(base, 0.74 * heroFigure)
  const sizeEnd = Math.max(Math.min(base, 0.74 * endFigure), Math.min(base, 72))
  const photoH = stacked ? Math.min(0.72 * openH, (0.84 * w) / 0.8) : Math.min(0.6 * h, (0.82 * openW) / 0.8)
  const coverH = stacked ? Math.min(0.7 * openH, (0.9 * w) / 1.76) : Math.min(0.56 * h, (0.86 * openW) / 1.76)
  const voiceW = stacked ? 0.68 * w : Math.min(0.68 * openW, 0.8 * h)
  const towerW = stacked ? Math.min(0.9 * w, 2.3 * openH) : Math.min(0.84 * openW, 0.74 * h)

  // --- Stations --------------------------------------------------------------
  const rest0: [number, number] = stacked
    ? [0.7 * w, view.hero.cy]
    : [view.hero.cx + 0.3 * view.hero.w, view.hero.cy + 0.02 * heroFigure]
  const rest1: [number, number] = [view.end.cx + (stacked ? 0.22 : 0.3) * view.end.w, view.end.cy]
  const photoAt = stacked ? spot(0.5, 0.57) : spot(0.5, 0.5)
  const roam = stacked ? spot(0.3, 0.5) : spot(0.24, 0.42)
  // Where the prismatic stone hangs as Research begins: low, close to the land it lights.
  const perch = stacked ? spot(0.5, 0.56) : spot(0.5, 0.55)
  // And where it hangs again after the tower, while night falls round it.
  const dusk = stacked ? spot(0.5, 0.56) : spot(0.5, 0.5)
  const voiceAt = stacked ? spot(0.5, 0.56) : spot(0.5, 0.47)
  const towerAt = stacked ? spot(0.5, 0.56) : spot(0.5, 0.42)
  const coverAt = stacked ? spot(0.5, 0.54) : spot(0.5, 0.45)

  // --- When each formation gives way to the next -------------------------------
  const p = marks.perScreen
  const quick = (at: number): [number, number] => [at - 0.035, at + 0.035]
  // Stone to photographs and back.
  const photoIn: [number, number] = reduced ? quick(2.16) : [2.04, PHOTO_FROM]
  const photoOut: [number, number] = reduced ? quick(2.94) : [PHOTO_TO, 3.0]
  // Stone to voice, as the first paper comes up the screen.
  const voiceIn: [number, number] = reduced
    ? quick(marks.hass - 0.36 * p)
    : [marks.hass - 0.56 * p, marks.hass - 0.24 * p]
  // Never before Research has begun, whatever the layout measures.
  voiceIn[0] = Math.max(3.97, voiceIn[0])
  voiceIn[1] = Math.max(voiceIn[0] + 0.04, voiceIn[1])
  // Voice to tower, as the second paper arrives and is held.
  const towerFrom = Math.max(voiceIn[1] + 0.03, marks.holdFrom - 0.3 * p)
  const towerIn: [number, number] = reduced
    ? quick(marks.holdFrom - 0.1 * p)
    : [towerFrom, Math.max(towerFrom + 0.03, marks.holdFrom + 0.04 * p)]
  // Tower back to the stone, once the paper is let go.
  const towerEnd = Math.max(towerIn[1] + 0.03, marks.holdTo + 0.03 * p)
  const towerOut: [number, number] = reduced
    ? quick(towerEnd + 0.05)
    : [towerEnd, Math.max(towerEnd + 0.03, marks.holdTo + 0.42 * p)]
  // Stone to the first project image, as the last of the night closes over
  // and the Projects heading comes in.
  const coverFrom = Math.max(towerOut[1] + 0.03, lerp(marks.nightFrom, marks.nightTo, 0.86))
  const coverIn: [number, number] = reduced
    ? quick(Math.min(4.94, coverFrom + 0.06))
    : [coverFrom, Math.max(coverFrom + 0.03, Math.min(4.985, coverFrom + 0.45 * p))]
  const coverOut: [number, number] = reduced ? quick(7.74) : [...COVER_OUT]
  // The voice breaks down between forming and gathering into the tower.
  const decay: [number, number] = [voiceIn[1] + 0.015, towerIn[0] - 0.01]
  // The tower plays its moves while the paper is held.
  const solve: [number, number] = [marks.holdFrom + 0.1 * p, marks.holdTo - 0.06 * p]

  // --- The stone's own path ------------------------------------------------------
  const keys = [
    ...[0, 0.38, 1.2, 2.0, 3.0, 3.5, 3.95, voiceIn[1]],
    ...[towerOut[0], coverIn[0], coverOut[0], 7.88, 8.3, 8.84, U_END],
  ]
  const stops: [number, number][] = [
    rest0,
    rest0,
    [lerp(rest0[0], photoAt[0], 0.55), lerp(rest0[1], photoAt[1], 0.75) - 0.06 * h],
    photoAt,
    photoAt,
    roam,
    perch,
    perch,
    dusk,
    dusk,
    coverAt,
    coverAt,
    [lerp(coverAt[0], rest1[0], 0.45), lerp(coverAt[1], rest1[1], 0.55)],
    rest1,
    rest1,
  ]
  const xAt = pchip(
    keys,
    stops.map((s) => s[0]),
  )
  const yAt = pchip(
    keys,
    stops.map((s) => s[1]),
  )
  const big = stacked ? base : base * 1.1
  const gem = stacked ? base * 1.1 : base * 1.25
  const sizeAt = pchip(
    [0, 0.38, 2.0, 3.0, 3.95, voiceIn[1], towerOut[0], coverIn[0], coverOut[0], 7.88, 8.84, U_END],
    [sizeHero, sizeHero, big, big, gem, gem, gem, gem, base, base, sizeEnd, sizeEnd],
  )
  // The stone turns as the page moves: whole turns between the moments it has
  // to break apart, so it always meets them the same way round.
  const yawAt = pchip(
    [0, 0.38, 2.0, 3.0, voiceIn[0], towerOut[1], coverIn[0], coverOut[1], 8.84, U_END],
    [0, 0, TAU, TAU, 2 * TAU, 2 * TAU, 3 * TAU, 3 * TAU, 4 * TAU, 4 * TAU],
  )

  const between = (span: [number, number], u: number) => smoother(span[0], span[1], u)
  const hang = (out: Place, at: [number, number], size: number, poses: Pose[], flip: number) => {
    const k = Math.min(poses.length - 1, Math.floor(flip))
    const a = poses[k]
    const b = poses[Math.min(poses.length - 1, k + 1)]
    const t = smooth(0, 1, flip - k)
    const scale = stacked ? 0.45 : 1
    out.x = at[0] + lerp(a.dx, b.dx, t) * w * scale
    out.y = at[1] + lerp(a.dy, b.dy, t) * h * scale
    out.size = size * lerp(a.size, b.size, t)
    out.yaw = lerp(a.yaw, b.yaw, t) * (stacked ? 0.6 : 1)
    out.roll = lerp(a.roll, b.roll, t)
    out.pitch = 0.03
  }

  const evaluate = (uRaw: number, c: Companion) => {
    const u = clamp(uRaw, 0, U_END)
    c.u = u

    // --- Which two formations, and how far between them -----------------------
    if (u < 3.4) {
      c.from = FORM.stone
      c.to = FORM.photo
      c.mix = between(photoIn, u) * (1 - between(photoOut, u))
    } else if (u < (voiceIn[1] + towerIn[0]) / 2) {
      c.from = FORM.stone
      c.to = FORM.voice
      c.mix = between(voiceIn, u)
    } else if (u < (towerIn[1] + towerOut[0]) / 2) {
      c.from = FORM.voice
      c.to = FORM.tower
      c.mix = between(towerIn, u)
    } else if (u < (towerOut[1] + coverIn[0]) / 2) {
      c.from = FORM.stone
      c.to = FORM.tower
      c.mix = 1 - between(towerOut, u)
    } else {
      c.from = FORM.stone
      c.to = FORM.cover
      c.mix = between(coverIn, u) * (1 - between(coverOut, u))
    }

    // --- What each formation is doing ------------------------------------------
    // Pictures share a sheet's time; between two of them the tiles turn over
    // in a wave.
    let flip = 0
    if (u < 3.4) {
      const turns = Math.max(0, photos - 1)
      const shown = (PHOTO_TO - PHOTO_FROM - turns * FLIP) / Math.max(1, photos)
      for (let k = 0; k < turns; k++) flip += clamp((u - (PHOTO_FROM + (k + 1) * shown + k * FLIP)) / FLIP)
    } else {
      for (const at of COVER_TURNS) flip += clamp((u - (at - FLIP / 2)) / FLIP)
    }
    c.flip = flip
    c.decay = clamp((u - decay[0]) / Math.max(1e-4, decay[1] - decay[0]))
    c.moves = TOWER_MOVE_COUNT * clamp((u - solve[0]) / Math.max(1e-4, solve[1] - solve[0]))
    const standing = between(towerIn, u) * (1 - between(towerOut, u))
    c.pegs = smooth(0.5, 0.95, standing)
    // Research is the prism chapter, from the first of the kaleidoscope's
    // spots until night has covered the last of it. Where on screen it shows
    // is the spots' business (see SCREEN in shaders.ts): this only says when
    // there is any of it to draw.
    c.prism = u > BLOOM_FROM && u < marks.nightTo ? 1 : 0
    c.lift = smoother(0.36, 1.1, u) * (1 - smoother(8.3, 8.86, u))

    // --- Where each formation is -------------------------------------------------
    const s = c.stone
    s.x = xAt(u)
    s.y = yAt(u)
    s.size = sizeAt(u)
    const yaw = reduced ? 0 : yawAt(u)
    s.yaw = yaw
    s.pitch = 0.22 * Math.sin(yaw * 0.5)
    s.roll = 0.13 * Math.sin(yaw)

    hang(c.photo, photoAt, photoH, PHOTO_POSES, u < 3.4 ? flip : 0)
    hang(c.cover, coverAt, coverH, COVER_POSES, u < 3.4 ? 0 : flip)

    c.voice.x = voiceAt[0]
    c.voice.y = voiceAt[1]
    c.voice.size = voiceW
    c.voice.yaw = stacked ? -0.12 : -0.3
    c.voice.pitch = 0.1
    c.voice.roll = 0

    c.tower.x = towerAt[0]
    c.tower.y = towerAt[1]
    c.tower.size = towerW
    c.tower.yaw = 0
    c.tower.pitch = 0.3
    c.tower.roll = 0
    return c
  }

  return { evaluate }
}

export type Director = ReturnType<typeof createDirector>
