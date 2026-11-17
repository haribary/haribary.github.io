import { DEFAULT_MARKS, type Companion, type Marks } from "./companion"
import type { View } from "./story"

/** The canvas never renders above this pixel ratio, however dense the screen. */
export const MAX_DPR = 1.75

/**
 * The one mutable object shared by the DOM side (scroll, pointer, layout) and
 * the canvas. Plain fields, written by the controller and read once per
 * rendered frame, so nothing here ever triggers a React render.
 */
export type Store = {
  /** Story time from scroll, 0..9. */
  u: number
  /** Dev only: pins the story time regardless of scroll. */
  override: number | null
  /** Pointer position, -1..1 on both axes; the scene eases toward it. */
  pointer: { x: number; y: number }
  view: View
  /** Bumped whenever `view` changes so the scene can rebuild its camera rig. */
  viewVersion: number
  /** Right edge of the text column as a fraction of the viewport width. */
  columnEdge: number
  /** Story times measured from the DOM: where in Research the two papers are read. */
  marks: Marks
  /** Dev only: fields of the companion to pin, whatever the story time says. */
  force: Partial<Pick<Companion, "from" | "to" | "mix" | "flip" | "moves" | "pegs" | "decay" | "prism">> | null
  reduced: boolean
  /** Asks the canvas for one more frame. Set by the scene once it exists. */
  invalidate: () => void
}

export function createStore(): Store {
  const w = typeof window === "undefined" ? 1440 : window.innerWidth
  const h = typeof window === "undefined" ? 900 : window.innerHeight
  return {
    u: 0,
    override: null,
    pointer: { x: 0, y: 0 },
    view: {
      w,
      h,
      hero: { cx: w / 2, cy: h * 0.52, w: w * 0.84, h: h * 0.4 },
      end: { cx: w / 2, cy: h * 0.5, w: w * 0.84, h: h * 0.4 },
      stacked: w / h < 0.9 || w <= 760,
      dpr: 1,
      exact: false,
    },
    viewVersion: 0,
    columnEdge: 0.46,
    marks: { ...DEFAULT_MARKS },
    force: null,
    reduced: false,
    invalidate: () => {},
  }
}
