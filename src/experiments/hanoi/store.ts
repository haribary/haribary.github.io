/**
 * Shared mutable state between the DOM page and the WebGL scene. The page
 * measures sections and writes here; the scene reads it every frame. Changes
 * the DOM must react to go through `emit`.
 */

export type WordSpec =
  | { mode: "fit"; width: number } // word width as a fraction of the view
  | { mode: "edge"; align: "left" | "right"; edge: number; height: number }
  | { mode: "center"; height: number }

export type Layout = {
  /** Screen position of the tower's centre, as fractions of the canvas. */
  sx: number
  sy: number
  /** Tower width as a fraction of the canvas width (capped by height). */
  fit: number
  fitH: number
  word: WordSpec
}

export type LayoutKey = "hero" | "left" | "right" | "play"

export const DESKTOP: Record<LayoutKey, Layout> = {
  hero: { sx: 0.5, sy: 0.6, fit: 0.7, fitH: 0.5, word: { mode: "fit", width: 1.0 } },
  left: { sx: 0.275, sy: 0.6, fit: 0.48, fitH: 0.5, word: { mode: "edge", align: "right", edge: 0.555, height: 0.27 } },
  right: { sx: 0.725, sy: 0.6, fit: 0.48, fitH: 0.5, word: { mode: "edge", align: "left", edge: 0.445, height: 0.27 } },
  play: { sx: 0.5, sy: 0.52, fit: 0.6, fitH: 0.5, word: { mode: "center", height: 0.3 } },
}

/** Narrow screens: the canvas is a band at the top; the tower holds it. */
export const MOBILE: Record<LayoutKey, Layout> = {
  hero: { sx: 0.5, sy: 0.68, fit: 0.97, fitH: 0.62, word: { mode: "fit", width: 1.0 } },
  left: { sx: 0.5, sy: 0.68, fit: 0.97, fitH: 0.62, word: { mode: "center", height: 0.3 } },
  right: { sx: 0.5, sy: 0.68, fit: 0.97, fitH: 0.62, word: { mode: "center", height: 0.3 } },
  play: { sx: 0.5, sy: 0.68, fit: 0.97, fitH: 0.62, word: { mode: "center", height: 0.3 } },
}

export type SectionMark = { top: number; layout: LayoutKey; word: number }

type Listener = () => void

export const store = {
  sections: [] as SectionMark[],
  vh: 900,
  /** Scroll offsets (px) that bound the scripted solve and the reset. */
  moveStart: 0,
  moveEnd: 1,
  resetStart: 1,
  resetEnd: 2,
  playAt: 2,
  darkStart: 2,
  darkEnd: 3,
  maxScroll: 1,
  mobile: false,
  reduced: false,
  finePointer: true,
  pointer: { x: 0, y: 0 },
  root: null as HTMLElement | null,
  pegButtons: [] as (HTMLElement | null)[],
  readout: null as HTMLElement | null,

  // Written by the scene, read by the DOM.
  shownMoves: 0,
  lastDisc: -1,
  playActive: false,
  resetting: false,

  listeners: new Set<Listener>(),
  emit() {
    store.listeners.forEach((l) => l())
  },
  subscribe(l: Listener) {
    store.listeners.add(l)
    return () => {
      store.listeners.delete(l)
    }
  },
}

/** Which section layouts to blend between at scroll offset `y`. */
export function layoutAt(y: number) {
  const s = store.sections
  if (s.length === 0) return { a: 0, b: 0, e: 0 }
  const vh = store.vh
  for (let i = s.length - 1; i >= 1; i--) {
    const start = s[i].top - (store.mobile ? 0.45 : 0.78) * vh
    const end = s[i].top - (store.mobile ? 0.15 : 0.4) * vh
    if (y >= end) return { a: i, b: i, e: 0 }
    if (y >= start) {
      const t = (y - start) / (end - start)
      return { a: i - 1, b: i, e: t * t * (3 - 2 * t) }
    }
  }
  return { a: 0, b: 0, e: 0 }
}
