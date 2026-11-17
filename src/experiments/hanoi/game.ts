import {
  DISCS,
  DISC_COUNT,
  LIFT_Y,
  PEG_NAMES,
  PEG_SPACING,
  PEG_X,
  clamp01,
  lerp,
  movePose,
  restY,
  type Pose,
} from "./solver"

/** One step of a disc's animation; `to` is where the step ends. */
type Seg = { kind: "arc" | "lift" | "hover" | "drop" | "shake" | "wait" | "scale"; to: Pose; dur: number }
type Anim = { from: Pose; start: number; segs: Seg[] }

const HOVER_Y = LIFT_Y + 0.12

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function evalSeg(seg: Seg, from: Pose, f: number): Pose {
  const to = seg.to
  switch (seg.kind) {
    case "arc":
      return { ...movePose(from.x, from.y, to.x, to.y, f, Math.max(LIFT_Y, from.y, to.y)), scale: to.scale }
    case "lift": {
      const e = easeOutCubic(f)
      return { x: to.x, y: lerp(from.y, to.y, e), tilt: lerp(from.tilt, 0, e), scale: to.scale }
    }
    case "hover": {
      const e = easeInOut(f)
      const dx = to.x - from.x
      return {
        x: lerp(from.x, to.x, e),
        y: lerp(from.y, to.y, e) + Math.sin(Math.PI * f) * Math.min(0.3, Math.abs(dx) * 0.06),
        tilt: -0.12 * Math.sin(Math.PI * f) * Math.sign(dx) * Math.min(1, Math.abs(dx) / PEG_SPACING),
        scale: to.scale,
      }
    }
    case "drop": {
      // Reuse the drop and settle half of a full move.
      const p = movePose(from.x, from.y, to.x, to.y, 0.66 * 0.8 + f * (1 - 0.66 * 0.8), from.y)
      return { ...p, x: to.x, scale: to.scale }
    }
    case "shake": {
      const decay = 1 - f
      const w = Math.sin(f * Math.PI * 7) * decay
      return { x: to.x + 0.14 * w, y: to.y, tilt: 0.07 * w, scale: to.scale }
    }
    case "scale": {
      const e = easeOutCubic(f)
      return { x: to.x, y: to.y, tilt: 0, scale: lerp(from.scale, to.scale, e) }
    }
    default:
      return from
  }
}

export type GameEvent = { message: string; disc: number }

/**
 * Play mode. Pure state (pegs, held disc, move count) plus a small time-based
 * animation queue per disc so every input is answered by motion.
 */
export class Game {
  n = 3
  pegs: number[][] = [[2, 1, 0], [], []]
  held: { disc: number; from: number } | null = null
  moves = 0
  solved = false
  lastDisc = -1
  version = 0
  private anims: (Anim | null)[] = new Array(DISC_COUNT).fill(null)
  private listeners = new Set<(e: GameEvent | null) => void>()

  get optimum() {
    return 2 ** this.n - 1
  }

  subscribe(l: (e: GameEvent | null) => void) {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  private notify(message: string | null, disc = -1) {
    this.version++
    this.listeners.forEach((l) => l(message === null ? null : { message, disc }))
  }

  /** The resting place of a disc in the current state, ignoring animation. */
  restPose(d: number): Pose {
    if (d >= this.n) return { x: PEG_X[0], y: restY(0), tilt: 0, scale: 0 }
    if (this.held?.disc === d) return { x: PEG_X[this.held.from], y: HOVER_Y, tilt: 0, scale: 1 }
    for (let p = 0; p < 3; p++) {
      const level = this.pegs[p].indexOf(d)
      if (level >= 0) return { x: PEG_X[p], y: restY(level), tilt: 0, scale: 1 }
    }
    return { x: PEG_X[0], y: restY(0), tilt: 0, scale: 0 }
  }

  pose(d: number, now: number, idle: boolean): Pose {
    const a = this.anims[d]
    if (a) {
      let t = now - a.start
      let from = a.from
      for (const seg of a.segs) {
        if (t < seg.dur) return evalSeg(seg, from, clamp01(t / seg.dur))
        t -= seg.dur
        from = seg.to
      }
      this.anims[d] = null
    }
    const rest = this.restPose(d)
    if (idle && this.held?.disc === d) {
      // A held disc breathes a little so it reads as "in hand".
      return { ...rest, y: rest.y + Math.sin(now * 2.4) * 0.035, tilt: Math.sin(now * 1.7) * 0.012 }
    }
    return rest
  }

  private animate(d: number, now: number, segs: Seg[], current: Pose) {
    this.anims[d] = { from: current, start: now, segs }
  }

  /** Put `n` discs back on peg A. Used on entry, for "start over" and "add a disc". */
  reset(n: number, now: number, animate = true) {
    const prevN = this.n
    const snapshot = animate ? Array.from({ length: DISC_COUNT }, (_, d) => this.pose(d, now, false)) : null
    const current = snapshot ? (d: number) => snapshot[d] : null
    this.n = Math.max(3, Math.min(DISC_COUNT, n))
    this.pegs = [[], [], []]
    for (let d = this.n - 1; d >= 0; d--) this.pegs[0].push(d)
    this.held = null
    this.moves = 0
    this.solved = false
    if (current) {
      for (let d = 0; d < DISC_COUNT; d++) {
        const from = current(d)
        const to = this.restPose(d)
        if (d >= this.n) {
          this.animate(d, now, [{ kind: "scale", to, dur: 0.4 }], from)
        } else if (d >= prevN || from.scale < 0.01) {
          // A new disc grows in place at the bottom of peg A.
          this.animate(d, now, [{ kind: "scale", to, dur: 0.45 }], { ...to, scale: 0 })
        } else {
          const delay = 0.08 + (this.n - 1 - d) * 0.09
          this.animate(
            d,
            now,
            [
              { kind: "wait", to: from, dur: delay },
              { kind: "arc", to, dur: 0.85 },
            ],
            from,
          )
        }
      }
    } else {
      this.anims.fill(null)
    }
    const words = ["", "", "", "Three", "Four", "Five"]
    this.notify(
      prevN === this.n
        ? `Back to the start: ${words[this.n].toLowerCase()} discs on peg A. Your move.`
        : `${words[this.n]} discs on peg A. The fewest possible is now ${this.optimum} moves.`,
    )
  }

  describePeg(p: number) {
    const stack = this.pegs[p]
    const name = `Peg ${PEG_NAMES[p]}`
    const holding = this.held?.from === p ? `, holding the ${DISCS[this.held.disc].name} disc above it` : ""
    if (stack.length === 0) return `${name}, empty${holding}`
    const names = stack.map((d) => DISCS[d].name)
    const count = `${stack.length} ${stack.length === 1 ? "disc" : "discs"}`
    return `${name}, ${count}, bottom to top: ${names.join(", ")}${holding}`
  }

  /** Click or key on a peg. */
  select(p: number, now: number) {
    if (this.solved) {
      this.notify("Solved. Add a disc or start over to play again.")
      return
    }
    const peg = PEG_NAMES[p]
    if (!this.held) {
      const stack = this.pegs[p]
      if (stack.length === 0) {
        this.notify(`Peg ${peg} is empty. Pick a peg with a disc on it.`)
        return
      }
      const d = stack[stack.length - 1]
      const cur = this.pose(d, now, false)
      stack.pop()
      this.held = { disc: d, from: p }
      this.animate(d, now, [{ kind: "lift", to: { x: PEG_X[p], y: HOVER_Y, tilt: 0, scale: 1 }, dur: 0.32 }], cur)
      this.notify(`Lifted the ${DISCS[d].name} disc from peg ${peg}. Choose where to put it.`, d)
      return
    }
    const { disc: d, from } = this.held
    const cur = this.pose(d, now, false)
    const hover = (q: number): Pose => ({ x: PEG_X[q], y: HOVER_Y, tilt: 0, scale: 1 })
    if (p === from) {
      this.held = null
      this.pegs[from].push(d)
      this.animate(d, now, [{ kind: "drop", to: this.restPose(d), dur: 0.5 }], cur)
      this.notify(`Put the ${DISCS[d].name} disc back on peg ${peg}.`, d)
      return
    }
    const top = this.pegs[p][this.pegs[p].length - 1]
    if (top !== undefined && top < d) {
      // Illegal: carry it over, refuse, bring it home.
      this.held = null
      this.pegs[from].push(d)
      const home = this.restPose(d)
      this.animate(
        d,
        now,
        [
          { kind: "hover", to: hover(p), dur: 0.4 },
          { kind: "shake", to: hover(p), dur: 0.42 },
          { kind: "hover", to: hover(from), dur: 0.4 },
          { kind: "drop", to: home, dur: 0.45 },
        ],
        cur,
      )
      this.notify(
        `The ${DISCS[d].name} disc can't go on the smaller ${DISCS[top].name} disc. It went back to peg ${PEG_NAMES[from]}.`,
        d,
      )
      return
    }
    this.held = null
    this.pegs[p].push(d)
    this.moves++
    this.lastDisc = d
    this.animate(
      d,
      now,
      [
        { kind: "hover", to: hover(p), dur: 0.42 },
        { kind: "drop", to: this.restPose(d), dur: 0.5 },
      ],
      cur,
    )
    if (this.pegs[2].length === this.n) {
      this.solved = true
      const best = this.moves === this.optimum
      this.notify(
        `Move ${this.moves}: ${DISCS[d].name} disc to peg ${peg}. Solved in ${this.moves} moves${
          best ? ", the fewest possible" : `; the fewest possible is ${this.optimum}`
        }.`,
        d,
      )
    } else {
      this.notify(`Move ${this.moves}: ${DISCS[d].name} disc to peg ${peg}.`, d)
    }
  }
}
