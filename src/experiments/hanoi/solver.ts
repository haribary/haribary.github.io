/**
 * Tower of Hanoi: dimensions of the object, the optimal solution, and pure
 * pose functions. Nothing here touches React or three; every pose is a plain
 * function of its inputs so a scroll position always renders the same frame.
 */

export const DISC_COUNT = 5
export const PEG_NAMES = ["A", "B", "C"] as const

/** Smallest first. The hue order is also the size order. */
export const DISCS = [
  { hue: "#FF4B33", name: "red" },
  { hue: "#FFB000", name: "amber" },
  { hue: "#17B26A", name: "green" },
  { hue: "#2D6BFF", name: "blue" },
  { hue: "#8B3DFF", name: "violet" },
] as const

// World dimensions (units are arbitrary; the camera fits them to the screen).
export const DISC_H = 0.34
export const DISC_GAP = 0.004
export const HOLE_R = 0.2
export const OUTER_R = [0.56, 0.72, 0.88, 1.04, 1.2]
export const PEG_R = 0.085
export const PEG_SPACING = 2.58
export const PEG_X = [-PEG_SPACING, 0, PEG_SPACING]
export const BASE_W = PEG_SPACING * 2 + OUTER_R[4] * 2 + 0.24
export const BASE_D = OUTER_R[4] * 2 + 0.24
export const BASE_H = 0.12
export const BASE_TOP = BASE_H
export const PEG_H = DISC_COUNT * (DISC_H + DISC_GAP) + 0.26
export const PEG_TOP = BASE_TOP + PEG_H
/** Height of a disc's centre while it travels between pegs. */
export const LIFT_Y = PEG_TOP + DISC_H / 2 + 0.2
/** Vertical centre of the full stack, used to aim the camera and the type. */
export const STACK_MID = BASE_TOP + (DISC_COUNT * DISC_H) / 2

export type Move = { disc: number; from: number; to: number }

export function solve(n: number, from = 0, to = 2, via = 1, out: Move[] = []): Move[] {
  if (n === 0) return out
  solve(n - 1, from, via, to, out)
  out.push({ disc: n - 1, from, to })
  solve(n - 1, via, to, from, out)
  return out
}

export const MOVES = solve(DISC_COUNT)
export const MOVE_COUNT = MOVES.length // 31

/** Peg contents (bottom to top) after `k` optimal moves. Precomputed. */
const STATES: number[][][] = (() => {
  const pegs: number[][] = [[4, 3, 2, 1, 0], [], []]
  const states = [pegs.map((p) => [...p])]
  for (const m of MOVES) {
    const d = pegs[m.from].pop()
    if (d !== m.disc) throw new Error("illegal optimal move")
    const top = pegs[m.to][pegs[m.to].length - 1]
    if (top !== undefined && top < d) throw new Error("illegal optimal move")
    pegs[m.to].push(d)
    states.push(pegs.map((p) => [...p]))
  }
  return states
})()

export function stateAfter(k: number) {
  return STATES[Math.max(0, Math.min(MOVE_COUNT, k))]
}

export const restY = (level: number) => BASE_TOP + DISC_GAP + level * (DISC_H + DISC_GAP) + DISC_H / 2

export type Pose = { x: number; y: number; tilt: number; scale: number }

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInQuad = (t: number) => t * t
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2

/**
 * One move, f in [0, 1]: lift (0 to 0.3), arc across (0.24 to 0.72), drop
 * with gravity (0.66 to 0.8), then a short damped settle (0.8 to 1).
 * `lift` is the travel height; a disc never passes through a peg.
 */
export function movePose(x0: number, y0: number, x1: number, y1: number, f: number, lift = LIFT_Y): Pose {
  const s = clamp01(f / 0.8)
  const dx = x1 - x0
  const travel = clamp01((s - 0.24) / 0.48)
  const x = x0 + dx * easeInOutSine(travel)
  let y: number
  if (s < 0.5) y = lerp(y0, lift, easeOutCubic(clamp01(s / 0.3)))
  else y = lerp(lift, y1, easeInQuad(clamp01((s - 0.66) / 0.14)))
  // A low hump over the middle peg so the path reads as an arc, not a bracket.
  y += Math.sin(Math.PI * travel) * Math.min(0.35, Math.abs(dx) * 0.06)
  // Bank into the direction of travel, proportional to horizontal speed.
  const v = (Math.PI / 2) * Math.sin(Math.PI * travel) * Math.sign(dx)
  let tilt = travel > 0 && travel < 1 ? -0.075 * v * Math.min(1, Math.abs(dx) / PEG_SPACING) : 0
  // Settle: a small bounce and wobble after landing.
  if (f > 0.8) {
    const u = (f - 0.8) / 0.2
    const decay = Math.exp(-5 * u)
    y += 0.05 * Math.abs(Math.sin(Math.PI * 2 * u)) * decay
    tilt += 0.03 * Math.sin(Math.PI * 3 * u) * decay * Math.sign(dx || 1)
  }
  return { x, y, tilt, scale: 1 }
}

function restPoses(pegs: number[][], out: Pose[]) {
  pegs.forEach((stack, p) =>
    stack.forEach((d, level) => {
      out[d] = { x: PEG_X[p], y: restY(level), tilt: 0, scale: 1 }
    }),
  )
}

/** Where the active move is: index of the move in progress and its phase. */
export function moveCursor(t: number) {
  const k = Math.min(MOVE_COUNT - 1, Math.max(0, Math.floor(t)))
  const frac = clamp01(t - k)
  // A short dwell at the start of each unit and a longer one after landing,
  // so each move reads on its own at normal scroll speed.
  const f = clamp01((frac - 0.06) / 0.84)
  return { k, f }
}

/** Number of moves begun (shown in the readout). */
export function movesShown(t: number) {
  if (t >= MOVE_COUNT) return MOVE_COUNT
  const { k, f } = moveCursor(t)
  return f > 0 ? k + 1 : k
}

/**
 * Pose of every disc for scroll progress `t` (0..31 moves) and reset
 * progress `r` (0..1: the solved five-disc tower becomes three discs on A).
 */
export function scrollPoses(t: number, r: number): Pose[] {
  const out: Pose[] = new Array(DISC_COUNT)
  if (t >= MOVE_COUNT || r > 0) {
    restPoses(stateAfter(MOVE_COUNT), out)
    if (r <= 0) return out
    // Top three lift together as a stack, carry over to A and set down.
    for (let d = 0; d < 3; d++) {
      const fromLevel = DISC_COUNT - 1 - d
      const toLevel = 2 - d
      const pose = movePose(PEG_X[2], restY(fromLevel), PEG_X[0], restY(toLevel), clamp01(r / 0.9), LIFT_Y + toLevel * (DISC_H + DISC_GAP))
      out[d] = pose
    }
    for (let d = 3; d < DISC_COUNT; d++) {
      const k = smooth(0.05 + (d - 3) * 0.1, 0.5 + (d - 3) * 0.1, r)
      out[d] = { ...out[d], y: out[d].y - 0.15 * k, scale: 1 - k }
    }
    return out
  }
  const { k, f } = moveCursor(t)
  const before = stateAfter(k)
  restPoses(before, out)
  if (f > 0) {
    const m = MOVES[k]
    const fromLevel = before[m.from].length - 1
    const toLevel = before[m.to].length
    out[m.disc] = movePose(PEG_X[m.from], restY(fromLevel), PEG_X[m.to], restY(toLevel), f)
  }
  return out
}

/** The disc that moved most recently at progress `t`, or -1 before any move. */
export function lastMovedDisc(t: number) {
  const n = movesShown(t)
  return n === 0 ? -1 : MOVES[n - 1].disc
}

export function describeMove(m: Move) {
  return `${DISCS[m.disc].name} disc, peg ${PEG_NAMES[m.from]} to peg ${PEG_NAMES[m.to]}`
}
