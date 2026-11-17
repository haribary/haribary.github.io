import { movePose, solve } from "../hanoi/solver"
import { clamp } from "./math"
import { TOWER } from "./shards"

/**
 * The Tower of Hanoi the shards build for the second paper: four discs, and
 * the last five moves of the optimal fifteen. The tower forms part way through
 * the solution and scrolling plays it out to the solved stack. Like everything
 * else on the page the pose of every disc is a pure function of one number,
 * here `t`, the number of those last moves made so far (fractions are a move
 * in progress).
 */

const SOLUTION = solve(TOWER.discs)
/** How many of the solution's moves are already behind the tower when it forms. */
const SKIPPED = 10
export const TOWER_MOVE_COUNT = SOLUTION.length - SKIPPED

/** Peg contents (bottom to top) after `k` moves of the whole solution. */
const STATES: number[][][] = (() => {
  const pegs: number[][] = [Array.from({ length: TOWER.discs }, (_, i) => TOWER.discs - 1 - i), [], []]
  const states = [pegs.map((p) => [...p])]
  for (const m of SOLUTION) {
    pegs[m.to].push(pegs[m.from].pop() as number)
    states.push(pegs.map((p) => [...p]))
  }
  return states
})()

/**
 * The discs as the tower first stands, read from the left peg to the right
 * and up each peg. The row of bars feeds them in this order (see shards.ts).
 */
export const TOWER_FEED: readonly number[] = STATES[SKIPPED].flat()

const restY = (level: number) => level * (TOWER.discH + TOWER.gap) + TOWER.discH / 2

/** Which move is under way at `t`, and how far through it is (0 while it waits). */
function cursor(t: number) {
  const k = Math.min(TOWER_MOVE_COUNT - 1, Math.max(0, Math.floor(t)))
  // A short rest before each lift and after each landing, so every move
  // reads on its own at an ordinary scrolling pace.
  return { k, f: clamp((t - k - 0.05) / 0.86) }
}

/**
 * Writes x, y, lean and 0 for each disc into `out` (16 numbers), in the units
 * the shader works in: the tower one unit wide, y measured from the height it
 * is centred on.
 */
export function towerPoses(t: number, out: Float32Array) {
  const done = t >= TOWER_MOVE_COUNT
  const { k, f } = done ? { k: TOWER_MOVE_COUNT, f: 0 } : cursor(t)
  const pegs = STATES[SKIPPED + k]
  for (let p = 0; p < 3; p++) {
    const stack = pegs[p]
    for (let level = 0; level < stack.length; level++) {
      const d = stack[level]
      out[d * 4] = TOWER.pegX[p] * TOWER.unit
      out[d * 4 + 1] = (restY(level) - TOWER.mid) * TOWER.unit
      out[d * 4 + 2] = 0
      out[d * 4 + 3] = 0
    }
  }
  if (f > 0) {
    const m = SOLUTION[SKIPPED + k]
    const pose = movePose(
      TOWER.pegX[m.from],
      restY(pegs[m.from].length - 1),
      TOWER.pegX[m.to],
      restY(pegs[m.to].length),
      f,
      TOWER.lift,
    )
    out[m.disc * 4] = pose.x * TOWER.unit
    out[m.disc * 4 + 1] = (pose.y - TOWER.mid) * TOWER.unit
    out[m.disc * 4 + 2] = pose.tilt
  }
  return out
}
