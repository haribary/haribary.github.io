/**
 * Shared, mutable motion state for Reel.
 *
 * One GSAP ticker callback (in index.tsx) writes this once per frame, right
 * after Lenis has moved the page; the WebGL scene, the captions, the giant
 * type and the section edges all read from it. Nothing here triggers React
 * renders.
 */

export const PALETTE = {
  butter: "#FFE27A",
  forest: "#0F3B2E",
  lilac: "#C9B6FF",
  tomato: "#F04A2E",
  offwhite: "#F6F3EC",
  ink: "#101312",
} as const

export const motion = {
  /** Page scroll in CSS px (Lenis's animated value). */
  scroll: 0,
  /** Viewport height in CSS px. */
  vh: 1,
  vw: 1,
  /** Raw Lenis velocity, px per frame. */
  raw: 0,
  /** Signed, smoothed velocity mapped to -1..1. Zero at rest. */
  vel: 0,
  /** |vel| run through an ease, 0..1. */
  speed: 0,
  /** Seconds since mount. */
  time: 0,
  /** Top of the spiral section and its height, CSS px. */
  spiralTop: 1,
  spiralHeight: 1,
  reduced: false,
  /** Bottom of the rasterised name as a fraction of the viewport height. */
  nameBottom: 0.6,
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Width axis value for giant type: extra-condensed at rest, opening up with speed. */
export const restWidth = 62
export const maxWidth = 112
export function breathingWidth(speed: number) {
  return restWidth + (maxWidth - restWidth) * speed
}

/** Number of photographs on the helix. */
export const CARD_COUNT = 7

/**
 * Where we are along the spiral, as a continuous card index ("slot").
 * Each card dwells at the front for a moment: the fractional part is eased
 * with flat ends, so a steady scroll still lets each face settle.
 */
export function spiralState(scroll: number, vh: number, top: number, height: number) {
  // 0 at the top of the page, 1 when the spiral section reaches the top of the screen.
  const intro = clamp(scroll / Math.max(1, top))
  // Distance into the spiral section, in viewport heights.
  const into = (scroll - top) / vh
  const travel = height / vh - 1 // the part where the section fills the screen
  const perCard = travel / (CARD_COUNT - 0.55)
  const raw = clamp(into / perCard, 0, CARD_COUNT - 1)
  const whole = Math.floor(raw)
  const frac = raw - whole
  // Hold for two thirds of each step, then a quick eased turn.
  const t = clamp((frac - 1 / 3) * 3)
  const eased = whole + t * t * t * (t * (t * 6 - 15) + 10)
  const slot = Math.min(CARD_COUNT - 1, eased)
  // The last card holds until the section's end reaches the bottom of the
  // screen, then leaves upward with the page (in vh).
  const exit = Math.max(0, into - travel)
  return { intro, slot, exit, raw }
}
